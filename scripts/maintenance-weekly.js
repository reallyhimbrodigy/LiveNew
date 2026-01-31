// Runbook: set BASE_URL (or SIM_BASE_URL), SMOKE_EMAIL, SMOKE_TOKEN for maintenance verification.
import { spawn } from "child_process";
import path from "path";

const ROOT = process.cwd();

function parseJsonLine(output) {
  if (!output) return null;
  const trimmed = output.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // try next
    }
  }
  return null;
}

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
      const parsed = parseJsonLine(stdout) || parseJsonLine(stderr);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), parsed });
    });
  });
}

async function main() {
  const res = await runNode(path.join(ROOT, "scripts", "maintenance-verify.js"));
  const ok = Boolean(res.ok && res.parsed?.ok !== false);
  const summary = {
    event: "maintenance_weekly_summary",
    ok,
    verify: res.parsed || null,
  };

  console.log(JSON.stringify(summary));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
