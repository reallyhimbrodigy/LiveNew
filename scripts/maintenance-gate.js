// Runbook: set BASE_URL (or SIM_BASE_URL), SMOKE_EMAIL, SMOKE_TOKEN; performs dry-run then verify.
import { spawn } from "child_process";
import path from "path";
import { writeArtifact } from "./lib/artifacts.js";
import { parseJsonLine } from "./lib/exec.js";

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
      const out = stdout.trim();
      const err = stderr.trim();
      resolve({ ok: code === 0, code, stdout: out, stderr: err, parsed: parseJsonLine(out) || parseJsonLine(err) });
    });
  });
}

async function run() {
  if (MOCK) {
    const ok = MOCK !== "fail";
    const summary = { ok, mock: true };
    console.log(JSON.stringify(summary));
    if (!ok) {
      writeArtifact("maintenance", "maintenance", summary);
      process.exit(1);
    }
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
  const maintenanceParsed = steps.find((entry) => entry.step === "maintenance_verify")?.parsed || null;
  const artifact = {
    ok,
    ranAt: new Date().toISOString(),
    retention: steps.find((entry) => entry.step === "retention_dry_run")?.parsed || null,
    maintenance: maintenanceParsed,
  };
  const artifactPath = writeArtifact("maintenance", "maintenance", artifact);
  summary.artifactPath = artifactPath;

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
