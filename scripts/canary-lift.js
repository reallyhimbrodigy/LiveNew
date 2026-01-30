import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const CURRENT_ALLOWLIST = process.env.CANARY_ALLOWLIST || "";
const CANDIDATES_ENV = process.env.CANARY_LIFT_CANDIDATES || "";
const CANDIDATE_FILE = process.env.CANARY_LIFT_FILE || "";
const LOG_PATHS = (process.env.CANARY_LOG_PATHS || process.env.LOG_PATHS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const REPORT_PATH =
  process.env.NIGHTLY_CANARY_REPORT ||
  process.env.CANARY_REPORT_PATH ||
  path.join(ROOT, "data", "nightly-canary.json");

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

function mergeAllowlist(current, candidates) {
  const seen = new Set();
  const out = [];
  current.forEach((entry) => {
    if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  });
  candidates.forEach((entry) => {
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
  };
}

function applyMonitoringCounters(counts, entry) {
  const counters = entry?.counts || {};
  counts.gatingViolations += Number(counters.gating_violation || 0);
  counts.nondeterminism += Number(counters.nondeterminism || 0);
  counts.contractInvalid += Number(counters.contract_invalid || 0);
  counts.writeStorm += Number(counters.write_storm || 0);
  counts.idempotencyMissing += Number(counters.idempotency_missing || 0);
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

async function loadNightlyReport(reportPath) {
  try {
    const raw = await fs.readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

async function main() {
  const current = parseList(CURRENT_ALLOWLIST);
  const candidates = await loadCandidates();
  const next = mergeAllowlist(current, candidates);

  let invariants = null;
  if (LOG_PATHS.length) {
    invariants = await scanLogs(LOG_PATHS);
  } else {
    const report = await loadNightlyReport(REPORT_PATH);
    if (report?.warnings) {
      invariants = {
        gatingViolations: report.warnings.gatingViolations || 0,
        nondeterminism: report.warnings.nondeterminism || 0,
        contractInvalid: report.warnings.contractInvalid || 0,
        writeStorm: report.warnings.writeStorm || 0,
        idempotencyMissing: report.warnings.missingIdempotencyWarnings || 0,
      };
    }
  }

  const output = {
    ok: true,
    currentAllowlist: current,
    candidates,
    nextAllowlist: next,
    nextAllowlistEnv: next.join(","),
    invariants,
    sources: {
      logPaths: LOG_PATHS,
      reportPath: LOG_PATHS.length ? null : REPORT_PATH,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
