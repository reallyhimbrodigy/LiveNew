// Runbook: set SIM_BASE_URL (or BASE_URL) and SMOKE_TOKEN for maintenance verify.
import { spawn } from "child_process";
import path from "path";

const ROOT = process.cwd();
const STRICT = process.env.RUNBOOK_STRICT !== "false";

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
  results.push({ step: "operate_mode_check", ...(await runNode(path.join(ROOT, "scripts", "operate-mode-check.js"))) });
  if (!results[0].ok) {
    console.log(JSON.stringify({ ok: false, steps: results }, null, 2));
    process.exit(1);
  }

  results.push({ step: "maintenance_gate", ...(await runNode(path.join(ROOT, "scripts", "maintenance-gate.js"))) });
  results.push({ step: "db_profile", ...(await runNode(path.join(ROOT, "scripts", "db-profile.js"))) });

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

  console.log(JSON.stringify(summary, null, 2));
  if (!ok && STRICT) process.exit(1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
