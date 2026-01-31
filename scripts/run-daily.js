// Runbook: set LOG_PATHS/REPORT_PATHS and PARITY_LOG_PATH before running.
import path from "path";
import { runNode } from "./lib/exec.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") ? true : process.env.RUNBOOK_STRICT !== "false";
const EVIDENCE_STRICT = process.argv.includes("--strict") ? true : process.env.EVIDENCE_STRICT === "true";

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

  results.push({ step: "check_client_parity", ...runNode(path.join(ROOT, "scripts", "check-client-parity.js")) });
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
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
  };

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
