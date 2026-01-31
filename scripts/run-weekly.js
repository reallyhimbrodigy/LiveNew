// Runbook: set SIM_BASE_URL (or BASE_URL) and SMOKE_TOKEN for maintenance verify.
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact, writeLog } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") || process.env.STRICT === "true" ? true : process.env.RUNBOOK_STRICT !== "false";

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
      logPaths[`${entry.step}.stdout`] = writeLog("weekly", `${entry.step}-stdout`, entry.stdout);
    }
    if (entry.stderr) {
      logPaths[`${entry.step}.stderr`] = writeLog("weekly", `${entry.step}-stderr`, entry.stderr);
    }
  });

  const dbParsed = results.find((entry) => entry.step === "db_profile")?.parsed || null;
  const artifact = {
    ok,
    ranAt: new Date().toISOString(),
    evidenceBundle: summary.evidenceBundle,
    dbProfile: dbParsed,
    logs: {
      paths: (process.env.LOG_PATHS || "").split(",").map((p) => p.trim()).filter(Boolean),
      outputs: logPaths,
    },
  };
  const artifactPath = writeArtifact("weekly", "weekly", artifact);
  summary.artifactPath = artifactPath;

  console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
  if (!ok) process.exit(1);
}

try {
  run();
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
}
