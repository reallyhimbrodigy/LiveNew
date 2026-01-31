// Runbook: set SIM_BASE_URL (or BASE_URL) and SIM_AUTH_TOKEN; optional AUTH_TOKEN for load-test.
import { spawn } from "child_process";
import path from "path";

const ROOT = process.cwd();
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const AUTH_TOKEN = process.env.AUTH_TOKEN || process.env.SIM_AUTH_TOKEN || "";

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
  const operateCheck = await runNode(path.join(ROOT, "scripts", "operate-mode-check.js"));
  if (!operateCheck.ok) {
    console.error(operateCheck.stderr || operateCheck.stdout || "operate-mode-check failed");
    process.exit(1);
  }
  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "SIM_BASE_URL or BASE_URL required" }));
    process.exit(1);
  }

  const results = [];
  results.push({ step: "operate_mode_check", ...operateCheck });
  results.push({ step: "verify_static_root", ...(await runNode(path.join(ROOT, "scripts", "verify-static-root.js"))) });
  results.push({ step: "canary_rollout_status", ...(await runNode(path.join(ROOT, "scripts", "canary-rollout.js"), { BASE_URL })) });
  results.push({ step: "verify_static_esm", ...(await runNode(path.join(ROOT, "scripts", "verify-static-esm.js"), { BASE_URL })) });
  results.push({
    step: "simulate_short",
    ...(await runNode(path.join(ROOT, "scripts", "simulate.js"), {
      SIM_BASE_URL: BASE_URL,
      SIM_AUTH_TOKEN: process.env.SIM_AUTH_TOKEN || "",
      SIM_DAYS: "3",
      SIM_CONCURRENCY: "false",
    })),
  });
  results.push({ step: "db_profile", ...(await runNode(path.join(ROOT, "scripts", "db-profile.js"))) });
  results.push({
    step: "load_test_small",
    ...(await runNode(path.join(ROOT, "scripts", "load-test.js"), {
      BASE_URL,
      AUTH_TOKEN,
      USERS: process.env.USERS || "10",
      JITTER_MS: process.env.JITTER_MS || "10",
    })),
  });
  results.push({
    step: "maintenance_verify",
    ...(await runNode(path.join(ROOT, "scripts", "maintenance-verify.js"), {
      SIM_BASE_URL: BASE_URL,
      SMOKE_TOKEN: process.env.SMOKE_TOKEN || "",
      SMOKE_EMAIL: process.env.SMOKE_EMAIL || "",
    })),
  });

  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    baseUrl: BASE_URL,
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
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
