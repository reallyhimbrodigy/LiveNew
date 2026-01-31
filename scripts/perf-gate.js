// Runbook: set BASE_URL and optional LOAD_TEST_PRESET, P95/P99 thresholds.
import { spawn } from "child_process";
import path from "path";

const ROOT = process.cwd();
const MOCK = process.env.PERF_GATE_MOCK === "true";
const BASE_URL = process.env.BASE_URL || process.env.SIM_BASE_URL || "";

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
  if (MOCK) {
    const loadOk = process.env.PERF_GATE_LOAD_OK !== "false";
    const dbOk = process.env.PERF_GATE_DB_OK !== "false";
    const ok = loadOk && dbOk;
    console.log(JSON.stringify({ ok, mock: true, loadTest: { ok: loadOk }, dbProfile: { ok: dbOk } }, null, 2));
    if (!ok) process.exit(1);
    return;
  }

  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "BASE_URL or SIM_BASE_URL required" }));
    process.exit(1);
  }

  const results = [];
  results.push({ step: "db_profile", ...(await runNode(path.join(ROOT, "scripts", "db-profile.js"))) });
  results.push({
    step: "load_test",
    ...(await runNode(path.join(ROOT, "scripts", "load-test.js"), { BASE_URL })),
  });

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
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
