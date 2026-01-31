// Runbook: set LOG_PATHS/REPORT_PATHS and PARITY_LOG_PATH before running.
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact, writeLog } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") || process.env.STRICT === "true" ? true : process.env.RUNBOOK_STRICT !== "false";
const EVIDENCE_STRICT = process.argv.includes("--strict") || process.env.STRICT === "true" ? true : process.env.EVIDENCE_STRICT === "true";

function summarizeLine(summary) {
  const failed = summary.steps.filter((entry) => !entry.ok).map((entry) => entry.step);
  return `run_daily ok=${summary.ok} failed=${failed.length ? failed.join(",") : "none"}`;
}

function run() {
  const results = [];
  results.push({ step: "operate_mode_check", ...runNode(path.join(ROOT, "scripts", "operate-mode-check.js")) });
  if (!results[0].ok) {
    const summary = { ok: false, steps: results };
    console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
    process.exit(results[0].code === 2 ? 2 : 1);
  }

  results.push({
    step: "check_client_parity",
    ...runNode(path.join(ROOT, "scripts", "check-client-parity.js"), { args: ["--json"] }),
  });
  results.push({ step: "collect_evidence", ...runNode(path.join(ROOT, "scripts", "collect-evidence.js")) });

  const parityEntry = results.find((entry) => entry.step === "check_client_parity");
  const parityOk = parityEntry?.ok === true;
  const ok =
    results.find((entry) => entry.step === "operate_mode_check")?.ok !== false &&
    parityOk &&
    (EVIDENCE_STRICT ? results.find((entry) => entry.step === "collect_evidence")?.ok === true : true);
  const summary = {
    ok,
    strict: STRICT,
    evidenceBundle: results[0].parsed?.evidenceBundle || null,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
  };

  const logPaths = {};
  results.forEach((entry) => {
    if (entry.stdout) {
      logPaths[`${entry.step}.stdout`] = writeLog("daily", `${entry.step}-stdout`, entry.stdout);
    }
    if (entry.stderr) {
      logPaths[`${entry.step}.stderr`] = writeLog("daily", `${entry.step}-stderr`, entry.stderr);
    }
  });

  const artifact = {
    ok,
    ranAt: new Date().toISOString(),
    evidenceBundle: summary.evidenceBundle,
    parity: parityEntry?.parsed || null,
    counters: results.find((entry) => entry.step === "collect_evidence")?.parsed?.counters || null,
    logs: {
      paths: (process.env.LOG_PATHS || "").split(",").map((p) => p.trim()).filter(Boolean),
      outputs: logPaths,
    },
  };
  const artifactPath = writeArtifact("daily", "daily", artifact);
  summary.artifactPath = artifactPath;

  console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
  if (!parityOk) process.exit(parityEntry?.code === 2 ? 2 : 1);
  if (!ok && STRICT) process.exit(1);
}

try {
  run();
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
}
