// Runbook: set BASE_URL or SIM_BASE_URL and SIM_AUTH_TOKEN; this runs launch-gate only.
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
  const operateCheck = await runNode(path.join(ROOT, "scripts", "operate-mode-check.js"));
  if (!operateCheck.ok) {
    console.error(operateCheck.stderr || operateCheck.stdout || "operate-mode-check failed");
    process.exit(1);
  }
  const result = await runNode(path.join(ROOT, "scripts", "launch-gate.js"));
  const output = {
    ok: result.ok,
    step: "launch_gate",
    note: result.ok ? result.stdout || null : result.stderr || result.stdout || null,
    nextSteps: [
      "Review launch-gate output and verify monitoring counters are clean.",
      "Run canary-rollout status for current invariants.",
      "If OK, proceed with canary expansion or full rollout.",
    ],
  };
  await runNode(path.join(ROOT, "scripts", "canary-rollout.js"));
  console.log(JSON.stringify(output, null, 2));
  if (!result.ok) process.exit(1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
