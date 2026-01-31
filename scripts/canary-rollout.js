// Runbook: set CANARY_ALLOWLIST, CANARY_ROLLOUT_CANDIDATES or CANARY_ROLLOUT_FILE, CANARY_BATCH_SIZE, LOG_PATHS, BASE_URL.
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();
const MODE = process.argv[2] || "status";
const CURRENT_ALLOWLIST = process.env.CANARY_ALLOWLIST || "";
const CANDIDATES_ENV = process.env.CANARY_ROLLOUT_CANDIDATES || "";
const CANDIDATE_FILE = process.env.CANARY_ROLLOUT_FILE || "";
const LOG_PATHS = (process.env.CANARY_LOG_PATHS || process.env.LOG_PATHS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const BATCH_SIZE = Math.max(1, Number(process.env.CANARY_BATCH_SIZE || 25));

function parseList(input) {
  if (!input) return [];
  return input
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

async function loadCandidates() {
  if (CANDIDATE_FILE) {
    const raw = await fs.readFile(path.isAbsolute(CANDIDATE_FILE) ? CANDIDATE_FILE : path.join(ROOT, CANDIDATE_FILE), "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
    } catch {
      return parseList(raw);
    }
  }
  return parseList(CANDIDATES_ENV);
}

function mergeAllowlist(current, additions) {
  const seen = new Set();
  const out = [];
  current.forEach((entry) => {
    if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  });
  additions.forEach((entry) => {
    if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  });
  return out;
}

function initInvariantCounters() {
  return {
    gatingViolations: 0,
    nondeterminism: 0,
    contractInvalid: 0,
    writeStorm: 0,
    idempotencyMissing: 0,
    idempotencyDuplicate: 0,
  };
}

function applyMonitoringCounters(counts, entry) {
  const counters = entry?.counts || {};
  counts.gatingViolations += Number(counters.gating_violation || 0);
  counts.nondeterminism += Number(counters.nondeterminism_detected || counters.nondeterminism || 0);
  counts.contractInvalid += Number(counters.contract_invalid || 0);
  counts.writeStorm += Number(counters.write_storm_429 || counters.write_storm || 0);
  counts.idempotencyMissing += Number(counters.idempotency_missing || 0);
  counts.idempotencyDuplicate += Number(counters.idempotency_duplicate || 0);
}

async function scanLogs(paths) {
  const counts = initInvariantCounters();
  for (const logPath of paths) {
    let raw = "";
    try {
      raw = await fs.readFile(logPath, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split("\n").filter(Boolean);
    lines.forEach((line) => {
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const event = entry?.event || "";
      if (event === "monitoring_counters") {
        applyMonitoringCounters(counts, entry);
        return;
      }
      if (event === "bootstrap_not_home") counts.gatingViolations += 1;
      if (event === "nondeterminism_detected") counts.nondeterminism += 1;
      if (event === "today_contract_invalid") counts.contractInvalid += 1;
      if (event === "write_storm") counts.writeStorm += 1;
      if (event === "idempotency_missing") counts.idempotencyMissing += 1;
    });
  }
  return counts;
}

function runNode(scriptPath, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runVerify() {
  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "SIM_BASE_URL or BASE_URL required" }));
    process.exit(1);
  }
  const results = [];
  results.push({ step: "verify_static_esm", ...(await runNode(path.join(ROOT, "scripts", "verify-static-esm.js"), { BASE_URL })) });
  results.push({
    step: "simulate_short",
    ...(await runNode(path.join(ROOT, "scripts", "simulate.js"), {
      SIM_BASE_URL: BASE_URL,
      SIM_DAYS: "3",
      SIM_CONCURRENCY: "false",
    })),
  });
  results.push({ step: "contract_drift", ...(await runNode(path.join(ROOT, "scripts", "golden.snapshots.js"))) });
  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

async function runStatus() {
  const current = parseList(CURRENT_ALLOWLIST);
  const candidates = await loadCandidates();
  const invariants = LOG_PATHS.length ? await scanLogs(LOG_PATHS) : null;
  const remaining = candidates.filter((entry) => !current.includes(entry));
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "status",
        currentAllowlist: current,
        candidates,
        remainingCount: remaining.length,
        invariants,
        sources: { logPaths: LOG_PATHS },
      },
      null,
      2
    )
  );
}

async function runNext() {
  const current = parseList(CURRENT_ALLOWLIST);
  const candidates = await loadCandidates();
  const remaining = candidates.filter((entry) => !current.includes(entry));
  let action = "expand_allowlist";
  let nextAllowlist = current;
  let batch = [];
  if (!remaining.length || remaining.length <= BATCH_SIZE) {
    action = "clear_allowlist";
    nextAllowlist = [];
  } else {
    batch = remaining.slice(0, BATCH_SIZE);
    nextAllowlist = mergeAllowlist(current, batch);
  }

  const envChanges = action === "clear_allowlist" ? { CANARY_ALLOWLIST: "" } : { CANARY_ALLOWLIST: nextAllowlist.join(",") };

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "next",
        action,
        batchSize: BATCH_SIZE,
        batch,
        currentAllowlist: current,
        candidates,
        nextAllowlist,
        nextAllowlistEnv: envChanges.CANARY_ALLOWLIST,
        requiredSteps: ["Set CANARY_ALLOWLIST in runtime env", "Restart service"],
      },
      null,
      2
    )
  );
}

async function main() {
  if (MODE === "verify") return runVerify();
  if (MODE === "next") return runNext();
  return runStatus();
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
