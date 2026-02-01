// Runbook: set SIM_BASE_URL (or BASE_URL) and SIM_AUTH_TOKEN for remote sims.
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact, writeLog } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") || process.env.STRICT === "true" ? true : process.env.RUNBOOK_STRICT !== "false";
const LIB_CHECK_ARGS = process.argv.includes("--strict") || process.env.STRICT === "true" ? ["--strict"] : [];
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const SKIP_NIGHTLY_CANARY = process.env.SKIP_NIGHTLY_CANARY === "true";

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
  if (!libCheck.ok) {
    const summary = { ok: false, steps: results };
    console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
    process.exit(libCheck.code === 2 ? 2 : 1);
  }
  if (libCheck.parsed?.libraries?.length) {
    results.push({ step: "catalog_coverage", ...runNode(path.join(ROOT, "scripts", "constraints.coverage.test.js")) });
  }

  if (SKIP_NIGHTLY_CANARY) {
    results.push({ step: "nightly_canary", ok: true, code: 0, stdout: "Skipped: SKIP_NIGHTLY_CANARY=true", stderr: "" });
  } else {
    results.push({
      step: "nightly_canary",
      ...runNode(path.join(ROOT, "scripts", "nightly-canary.js"), { SIM_BASE_URL: BASE_URL, SIM_CONCURRENCY: "true" }),
    });
  }
  results.push({ step: "perf_gate", ...runNode(path.join(ROOT, "scripts", "perf-gate.js"), { BASE_URL }) });

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
      logPaths[`${entry.step}.stdout`] = writeLog("nightly", `${entry.step}-stdout`, entry.stdout);
    }
    if (entry.stderr) {
      logPaths[`${entry.step}.stderr`] = writeLog("nightly", `${entry.step}-stderr`, entry.stderr);
    }
  });

  const nightlyParsed = results.find((entry) => entry.step === "nightly_canary")?.parsed || null;
  const perfParsed = results.find((entry) => entry.step === "perf_gate")?.parsed || null;
  const artifact = {
    ok,
    ranAt: new Date().toISOString(),
    exitCode: ok ? 0 : 1,
    evidenceBundle: summary.evidenceBundle,
    nondeterminism: nightlyParsed?.warnings?.nondeterminism ?? nightlyParsed?.nondeterminism ?? null,
    contractInvalid: nightlyParsed?.warnings?.contractInvalid ?? null,
    perf: perfParsed,
    logs: {
      paths: (process.env.LOG_PATHS || "").split(",").map((p) => p.trim()).filter(Boolean),
      outputs: logPaths,
    },
  };
  const artifactPath = writeArtifact("nightly", "nightly", artifact);
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
