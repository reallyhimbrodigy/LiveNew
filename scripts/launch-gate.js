// Runbook: set BASE_URL or SIM_BASE_URL and SIM_AUTH_TOKEN for remote runs; optionally set LOG_PATHS for log scans.
import fs from "fs/promises";
import path from "path";
import { runNode as execRunNode } from "./lib/exec.js";

const ROOT = process.cwd();
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const AUTH_TOKEN = process.env.SIM_AUTH_TOKEN || process.env.AUTH_TOKEN || process.env.SMOKE_TOKEN || "";
const DRY_RUN = process.env.LAUNCH_GATE_DRY_RUN === "true";
const OUTPUT_DIR = process.env.LAUNCH_GATE_OUTPUT_DIR || path.join(ROOT, "data", "launch-gate");
const LOG_PATHS = (process.env.LAUNCH_GATE_LOG_PATHS || process.env.LOG_PATHS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

function runNode(scriptPath, env = {}) {
  return Promise.resolve(execRunNode(scriptPath, { env }));
}

async function runSim(label, { days, concurrency }) {
  const env = {
    SIM_BASE_URL: BASE_URL,
    SIM_AUTH_TOKEN: AUTH_TOKEN,
    SIM_DAYS: String(days),
    SIM_CONCURRENCY: concurrency ? "true" : "false",
  };
  const res = await runNode(path.join(ROOT, "scripts", "simulate.js"), env);
  const outPath = path.join(OUTPUT_DIR, `${label}.json`);
  await fs.writeFile(outPath, JSON.stringify(res.parsed || { ok: res.ok, stdout: res.stdout, stderr: res.stderr }, null, 2));
  return { ...res, outputPath: outPath };
}

async function scanLogs(paths) {
  const counts = { nondeterminism: 0, contractInvalid: 0 };
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
      if (event === "nondeterminism_detected") counts.nondeterminism += 1;
      if (event === "today_contract_invalid") counts.contractInvalid += 1;
      if (event === "monitoring_counters") {
        const c = entry?.counts || {};
        counts.nondeterminism += Number(c.nondeterminism_detected || c.nondeterminism || 0);
        counts.contractInvalid += Number(c.contract_invalid || 0);
      }
    });
  }
  return counts;
}

async function main() {
  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          steps: [
            "operate_mode_check",
            "golden.snapshots",
            "mvp.unit",
            "verify_static_root",
            "verify_static_esm",
            "cache_headers",
            "export_surface",
            "bootstrap_gate",
            "static_smoke",
            "monitoring_counters",
            "launch_toggles",
            "canary_rollout_test",
            "perf_gate_test",
            "maintenance_gate_test",
            "launch_finalize_test",
            "evidence_scripts_test",
            "check_client_parity_test",
            "check_lib_version_bump_test",
            "operate_mode_check_test",
            "require_evidence_test",
            "full_traffic_gate_test",
            "simulate_short",
            "simulate_long",
            "simulate_concurrency",
            "lib_version_bump",
            "db-profile",
          ],
        },
        null,
        2
      )
    );
    return;
  }

  const operateCheck = await runNode(path.join(ROOT, "scripts", "operate-mode-check.js"));
  if (!operateCheck.ok) {
    console.error(operateCheck.stderr || operateCheck.stdout || "operate-mode-check failed");
    process.exit(operateCheck.code === 2 ? 2 : 1);
  }

  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "SIM_BASE_URL or BASE_URL required" }));
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const results = [];
  results.push({ step: "operate_mode_check", ...operateCheck });
  results.push({ step: "golden.snapshots", ...(await runNode(path.join(ROOT, "scripts", "golden.snapshots.js"))) });
  results.push({ step: "mvp.unit", ...(await runNode(path.join(ROOT, "scripts", "mvp.unit.test.js"))) });
  results.push({ step: "verify_static_root", ...(await runNode(path.join(ROOT, "scripts", "verify-static-root.js"))) });
  results.push({ step: "verify_static_esm", ...(await runNode(path.join(ROOT, "scripts", "verify-static-esm.js"))) });
  results.push({ step: "cache_headers", ...(await runNode(path.join(ROOT, "scripts", "cache-headers.test.js"))) });
  results.push({ step: "export_surface", ...(await runNode(path.join(ROOT, "scripts", "export-surface.test.js"))) });
  results.push({ step: "bootstrap_gate", ...(await runNode(path.join(ROOT, "scripts", "bootstrap-gate.test.js"))) });
  results.push({ step: "static_smoke", ...(await runNode(path.join(ROOT, "scripts", "static-smoke.test.js"))) });
  results.push({ step: "monitoring_counters", ...(await runNode(path.join(ROOT, "scripts", "monitoring-counters.test.js"))) });
  results.push({ step: "launch_toggles", ...(await runNode(path.join(ROOT, "scripts", "launch-toggles.test.js"))) });
  results.push({ step: "canary_rollout_test", ...(await runNode(path.join(ROOT, "scripts", "canary-rollout.test.js"))) });
  results.push({ step: "perf_gate_test", ...(await runNode(path.join(ROOT, "scripts", "perf-gate.test.js"))) });
  results.push({ step: "maintenance_gate_test", ...(await runNode(path.join(ROOT, "scripts", "maintenance-gate.test.js"))) });
  results.push({ step: "launch_finalize_test", ...(await runNode(path.join(ROOT, "scripts", "launch-finalize.test.js"))) });
  results.push({ step: "evidence_scripts_test", ...(await runNode(path.join(ROOT, "scripts", "evidence-scripts.test.js"))) });
  results.push({ step: "check_client_parity_test", ...(await runNode(path.join(ROOT, "scripts", "check-client-parity.test.js"))) });
  results.push({ step: "check_lib_version_bump_test", ...(await runNode(path.join(ROOT, "scripts", "check-lib-version-bump.test.js"))) });
  results.push({ step: "operate_mode_check_test", ...(await runNode(path.join(ROOT, "scripts", "operate-mode-check.test.js"))) });
  results.push({ step: "require_evidence_test", ...(await runNode(path.join(ROOT, "scripts", "require-evidence.test.js"))) });
  results.push({ step: "full_traffic_gate_test", ...(await runNode(path.join(ROOT, "scripts", "full-traffic-gate.test.js"))) });

  results.push({ step: "simulate_short", ...(await runSim("simulate_short", { days: 3, concurrency: false })) });
  results.push({ step: "simulate_long", ...(await runSim("simulate_long", { days: 7, concurrency: false })) });
  results.push({ step: "simulate_concurrency", ...(await runSim("simulate_concurrency", { days: 3, concurrency: true })) });

  results.push({ step: "lib_version_bump", ...(await runNode(path.join(ROOT, "scripts", "check-lib-version-bump.js"))) });
  results.push({ step: "db-profile", ...(await runNode(path.join(ROOT, "scripts", "db-profile.js"))) });

  const nondeterminism = results
    .filter((entry) => entry.parsed && typeof entry.parsed.nondeterminism === "number")
    .reduce((sum, entry) => sum + entry.parsed.nondeterminism, 0);

  let logCounters = { nondeterminism: 0, contractInvalid: 0 };
  if (LOG_PATHS.length) {
    logCounters = await scanLogs(LOG_PATHS);
  }

  const ok =
    results.every((entry) => entry.ok) &&
    nondeterminism === 0 &&
    logCounters.nondeterminism === 0 &&
    logCounters.contractInvalid === 0;

  const summary = {
    ok,
    baseUrl: BASE_URL,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      outputPath: entry.outputPath || null,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
    nondeterminism,
    logCounters,
    outputDir: OUTPUT_DIR,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
