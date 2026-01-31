// Runbook: set SIM_BASE_URL (or BASE_URL) and SIM_AUTH_TOKEN for remote sims.
import path from "path";
import { runNode } from "./lib/exec.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") ? true : process.env.RUNBOOK_STRICT !== "false";
const LIB_CHECK_ARGS = process.argv.includes("--strict") ? ["--strict"] : [];
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";

function summarizeLine(summary) {
  const failed = summary.steps.filter((entry) => !entry.ok).map((entry) => entry.step);
  return `run_nightly ok=${summary.ok} failed=${failed.length ? failed.join(",") : "none"}`;
}

function run() {
  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "missing_base_url" }));
    process.exit(2);
  }

  const results = [];
  results.push({ step: "operate_mode_check", ...runNode(path.join(ROOT, "scripts", "operate-mode-check.js")) });
  if (!results[0].ok) {
    const summary = { ok: false, steps: results };
    console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
    process.exit(results[0].code === 2 ? 2 : 1);
  }

  const libCheck = runNode(path.join(ROOT, "scripts", "check-lib-version-bump.js"), { args: LIB_CHECK_ARGS });
  results.push({ step: "lib_version_bump", ...libCheck });
  if (libCheck.parsed?.libraries?.length) {
    results.push({ step: "catalog_coverage", ...runNode(path.join(ROOT, "scripts", "constraints.coverage.test.js")) });
  }

  results.push({
    step: "nightly_canary",
    ...runNode(path.join(ROOT, "scripts", "nightly-canary.js"), { SIM_BASE_URL: BASE_URL, SIM_CONCURRENCY: "true" }),
  });
  results.push({ step: "perf_gate", ...runNode(path.join(ROOT, "scripts", "perf-gate.js"), { BASE_URL }) });

  const ok = results.every((entry) => entry.ok);
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
  if (!ok) process.exit(1);
}

try {
  run();
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
}
