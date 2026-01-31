import { spawn } from "child_process";
import path from "path";

const ROOT = process.cwd();

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

async function run() {
  const results = [];
  results.push({
    step: "operate_mode_check",
    ...(await runNode(path.join(ROOT, "scripts", "operate-mode-check.js"))),
  });
  if (!results[0].ok) {
    console.log(JSON.stringify({ ok: false, steps: results }, null, 2));
    process.exit(1);
  }

  results.push({
    step: "lib_version_bump",
    ...(await runNode(path.join(ROOT, "scripts", "check-lib-version-bump.js"))),
  });

  results.push({
    step: "migrations",
    ...(await runNode(path.join(ROOT, "scripts", "migrations.test.js"))),
  });

  results.push({
    step: "indexes",
    ...(await runNode(path.join(ROOT, "scripts", "db-profile.js"))),
  });

  results.push({
    step: "constraints",
    ...(await runNode(path.join(ROOT, "scripts", "constraints.coverage.test.js"))),
  });

  results.push({
    step: "verify_static_root",
    ...(await runNode(path.join(ROOT, "scripts", "verify-static-root.js"))),
  });

  results.push({
    step: "cache_headers",
    ...(await runNode(path.join(ROOT, "scripts", "cache-headers.test.js"))),
  });

  results.push({
    step: "export_surface",
    ...(await runNode(path.join(ROOT, "scripts", "export-surface.test.js"))),
  });

  results.push({
    step: "bootstrap_gate",
    ...(await runNode(path.join(ROOT, "scripts", "bootstrap-gate.test.js"))),
  });

  results.push({
    step: "monitoring_counters",
    ...(await runNode(path.join(ROOT, "scripts", "monitoring-counters.test.js"))),
  });

  results.push({
    step: "launch_toggles",
    ...(await runNode(path.join(ROOT, "scripts", "launch-toggles.test.js"))),
  });

  results.push({
    step: "canary_rollout_test",
    ...(await runNode(path.join(ROOT, "scripts", "canary-rollout.test.js"))),
  });

  results.push({
    step: "perf_gate_test",
    ...(await runNode(path.join(ROOT, "scripts", "perf-gate.test.js"))),
  });

  results.push({
    step: "maintenance_gate_test",
    ...(await runNode(path.join(ROOT, "scripts", "maintenance-gate.test.js"))),
  });

  results.push({
    step: "launch_finalize_test",
    ...(await runNode(path.join(ROOT, "scripts", "launch-finalize.test.js"))),
  });

  results.push({
    step: "evidence_scripts_test",
    ...(await runNode(path.join(ROOT, "scripts", "evidence-scripts.test.js"))),
  });

  results.push({
    step: "check_client_parity_test",
    ...(await runNode(path.join(ROOT, "scripts", "check-client-parity.test.js"))),
  });

  results.push({
    step: "check_lib_version_bump_test",
    ...(await runNode(path.join(ROOT, "scripts", "check-lib-version-bump.test.js"))),
  });

  results.push({
    step: "operate_mode_check_test",
    ...(await runNode(path.join(ROOT, "scripts", "operate-mode-check.test.js"))),
  });

  const baseUrl = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
  if (baseUrl) {
    results.push({
      step: "verify_static_esm",
      ...(await runNode(path.join(ROOT, "scripts", "verify-static-esm.js"), { BASE_URL: baseUrl })),
    });
    results.push({
      step: "static_smoke",
      ...(await runNode(path.join(ROOT, "scripts", "static-smoke.test.js"), { BASE_URL: baseUrl })),
    });
    results.push({
      step: "simulate",
      ...(await runNode(path.join(ROOT, "scripts", "simulate.js"), {
        SIM_BASE_URL: baseUrl,
        SIM_DAYS: "3",
        SIM_CONCURRENCY: "false",
      })),
    });
  } else {
    results.push({
      step: "verify_static_esm",
      ok: true,
      code: 0,
      stdout: "Skipped: set SIM_BASE_URL to run static ESM check",
      stderr: "",
    });
    results.push({
      step: "static_smoke",
      ok: true,
      code: 0,
      stdout: "Skipped: set SIM_BASE_URL to run static smoke",
      stderr: "",
    });
    results.push({
      step: "simulate",
      ok: true,
      code: 0,
      stdout: "Skipped: set SIM_BASE_URL to run remote simulation",
      stderr: "",
    });
  }

  if (process.env.SKIP_UNIT_TESTS === "true") {
    results.push({
      step: "unit_tests",
      ok: true,
      code: 0,
      stdout: "Skipped: SKIP_UNIT_TESTS=true",
      stderr: "",
    });
  } else {
    results.push({
      step: "unit_tests",
      ...(await runNode(path.join(ROOT, "scripts", "mvp.unit.test.js"))),
    });
  }

  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
