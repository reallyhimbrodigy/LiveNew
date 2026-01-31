// Runbook: set CANARY_ALLOWLIST, CANARY_EXPAND_CANDIDATES or CANARY_EXPAND_FILE, CANARY_BATCH_SIZE, BASE_URL.
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();
const CURRENT_ALLOWLIST = process.env.CANARY_ALLOWLIST || "";
const CANDIDATES_ENV = process.env.CANARY_EXPAND_CANDIDATES || "";
const CANDIDATE_FILE = process.env.CANARY_EXPAND_FILE || "";
const BATCH_SIZE = Math.max(1, Number(process.env.CANARY_BATCH_SIZE || 25));
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";

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

async function runChecks() {
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
  return results;
}

async function main() {
  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "SIM_BASE_URL or BASE_URL required" }));
    process.exit(1);
  }

  const current = parseList(CURRENT_ALLOWLIST);
  const candidates = await loadCandidates();
  const remaining = candidates.filter((entry) => !current.includes(entry));
  const batch = remaining.slice(0, BATCH_SIZE);
  const next = mergeAllowlist(current, batch);

  const checks = await runChecks();
  const ok = checks.every((entry) => entry.ok);

  const output = {
    ok,
    verdict: ok ? "OK_TO_EXPAND" : "DO_NOT_EXPAND",
    batchSize: BATCH_SIZE,
    currentAllowlist: current,
    candidates,
    batch,
    nextAllowlist: next,
    nextAllowlistEnv: next.join(","),
    checks: checks.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
