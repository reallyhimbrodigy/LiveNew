// Runbook: set BASE_URL (or SIM_BASE_URL), SMOKE_EMAIL, SMOKE_TOKEN; performs dry-run then verify.
import { spawn } from "child_process";
import path from "path";

const ROOT = process.cwd();
const MOCK = process.env.MAINTENANCE_GATE_MOCK || "";

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
    const ok = MOCK !== "fail";
    console.log(JSON.stringify({ ok, mock: true }));
    if (!ok) process.exit(1);
    return;
  }

  const steps = [];
  steps.push({ step: "retention_dry_run", ...(await runNode(path.join(ROOT, "scripts", "retention-dry-run.js"))) });
  steps.push({ step: "maintenance_verify", ...(await runNode(path.join(ROOT, "scripts", "maintenance-verify.js"))) });

  const ok = steps.every((entry) => entry.ok);
  const summary = {
    ok,
    steps: steps.map((entry) => ({
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
