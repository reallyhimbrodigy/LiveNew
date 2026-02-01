// Runbook: set BASE_URL (or SIM_BASE_URL), SMOKE_EMAIL, SMOKE_TOKEN; performs dry-run then verify.
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { writeArtifact, artifactsBaseDir, ensureDir } from "./lib/artifacts.js";
import { parseJsonLine, runNode as runNodeSync } from "./lib/exec.js";

const ROOT = process.cwd();
const MOCK = process.env.MAINTENANCE_GATE_MOCK || "";
const LOCK_PATH = path.join(artifactsBaseDir(), "maintenance", "retention-locked.json");

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

function currentRetentionConfig() {
  const retentionDays = Math.max(1, Number(process.env.RETENTION_DAYS || process.env.EVENT_RETENTION_DAYS || 90));
  const eventRetentionDays = Number(process.env.EVENT_RETENTION_DAYS || retentionDays);
  const idempotencyRetentionDays = Math.max(1, Number(process.env.IDEMPOTENCY_RETENTION_DAYS || 30));
  return { retentionDays, eventRetentionDays, idempotencyRetentionDays };
}

function readLock() {
  try {
    const raw = fs.readFileSync(LOCK_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function retentionMismatch(lock, current) {
  if (!lock) return false;
  const expected = lock?.retention || {};
  return (
    Number(expected.retentionDays) !== Number(current.retentionDays) ||
    Number(expected.eventRetentionDays) !== Number(current.eventRetentionDays) ||
    Number(expected.idempotencyRetentionDays) !== Number(current.idempotencyRetentionDays)
  );
}

function hasEvidenceOverride() {
  const evidenceId = (process.env.REQUIRED_EVIDENCE_ID || "").trim();
  const overrideReason = (process.env.OVERRIDE_REASON || "").trim();
  return Boolean(evidenceId && overrideReason);
}

async function run() {
  const startedAt = Date.now();
  const currentRetention = currentRetentionConfig();
  const lock = readLock();
  if (lock && retentionMismatch(lock, currentRetention) && !hasEvidenceOverride()) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "retention_lock_mismatch",
        locked: lock?.retention || null,
        current: currentRetention,
        required: ["REQUIRED_EVIDENCE_ID", "OVERRIDE_REASON"],
      })
    );
    process.exit(2);
  }

  if (MOCK) {
    const ok = MOCK !== "fail";
    const summary = { ok, mock: true };
    const artifactPath = writeArtifact("maintenance", "maintenance", {
      ...summary,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
    summary.artifactPath = artifactPath;
    console.log(JSON.stringify(summary));
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
  const maintenanceParsed = steps.find((entry) => entry.step === "maintenance_verify")?.parsed || null;

  let lockResult = null;
  if (ok) {
    ensureDir(path.dirname(LOCK_PATH));
    const lockRun = runNodeSync(path.join(ROOT, "scripts", "first-clean-maintenance-lock.js"));
    lockResult = lockRun.parsed || null;
  }

  const artifact = {
    ok,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    retention: steps.find((entry) => entry.step === "retention_dry_run")?.parsed || null,
    maintenance: maintenanceParsed,
    retentionLock: lockResult,
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
