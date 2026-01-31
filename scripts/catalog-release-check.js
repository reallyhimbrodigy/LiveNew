// Runbook: enforce controlled catalog releases during freeze windows.
import path from "path";
import { runNode } from "./lib/exec.js";
import { isCanaryEnabled } from "./lib/canary.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") || process.env.STRICT === "true";

function summarizeLine(summary) {
  const failed = summary.steps.filter((entry) => !entry.ok).map((entry) => entry.step);
  return `catalog_release ok=${summary.ok} failed=${failed.length ? failed.join(",") : "none"}`;
}

function outputAndExit(summary, code) {
  console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
  process.exit(code);
}

function run() {
  const missing = [];
  if (process.env.CATALOG_RELEASE_MODE !== "true") missing.push("CATALOG_RELEASE_MODE");
  if (process.env.CATALOG_FREEZE !== "true") missing.push("CATALOG_FREEZE");
  if (process.env.CANARY_MODE !== "true") missing.push("CANARY_MODE");
  if (missing.length) {
    outputAndExit({ ok: false, error: "catalog_release_mode_required", missing }, 2);
  }
  if (!isCanaryEnabled()) {
    outputAndExit({ ok: false, error: "canary_allowlist_required" }, 2);
  }

  const results = [];
  results.push({
    step: "operate_mode_check",
    ...runNode(path.join(ROOT, "scripts", "operate-mode-check.js"), { env: { CATALOG_RELEASE_INTENT: "true" } }),
  });
  if (!results[0].ok) {
    outputAndExit({ ok: false, steps: results }, results[0].code === 2 ? 2 : 1);
  }

  const libCheck = runNode(path.join(ROOT, "scripts", "check-lib-version-bump.js"), { args: STRICT ? ["--strict"] : [] });
  results.push({ step: "lib_version_bump", ...libCheck });
  results.push({ step: "catalog_coverage", ...runNode(path.join(ROOT, "scripts", "constraints.coverage.test.js")) });

  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
    rollout: {
      canaryMode: true,
      requiredSteps: ["set CANARY_ALLOWLIST", "run full-traffic gate", "monitor parity/perf"],
    },
  };

  outputAndExit(summary, ok ? 0 : 1);
}

run();
