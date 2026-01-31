// Runbook: set SIM_BASE_URL (or BASE_URL) and SMOKE_TOKEN for maintenance verify.
import path from "path";
import { runNode } from "./lib/exec.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") ? true : process.env.RUNBOOK_STRICT !== "false";

function summarizeLine(summary) {
  const failed = summary.steps.filter((entry) => !entry.ok).map((entry) => entry.step);
  return `run_weekly ok=${summary.ok} failed=${failed.length ? failed.join(",") : "none"}`;
}

function run() {
  const results = [];
  results.push({ step: "operate_mode_check", ...runNode(path.join(ROOT, "scripts", "operate-mode-check.js")) });
  if (!results[0].ok) {
    const summary = { ok: false, steps: results };
    console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
    process.exit(results[0].code === 2 ? 2 : 1);
  }

  results.push({ step: "maintenance_gate", ...runNode(path.join(ROOT, "scripts", "maintenance-gate.js")) });
  results.push({ step: "db_profile", ...runNode(path.join(ROOT, "scripts", "db-profile.js")) });

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
