// Runbook: internal maintenance actions (retention dry-run, idempotency cleanup, db-profile optional).
import { spawn } from "child_process";
import path from "path";
import { initDb, closeDb, cleanupIdempotencyKeys } from "../src/state/db.js";

const ROOT = process.cwd();
const IDEMPOTENCY_RETENTION_DAYS = Math.max(1, Number(process.env.IDEMPOTENCY_RETENTION_DAYS || 30));
const RUN_DB_PROFILE = process.env.RUN_DB_PROFILE === "true";

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

async function runRetentionDryRun() {
  // Runbook: 1) Always dry-run retention first. 2) If protected tables are listed for delete, stop.
  // Runbook: 3) Only proceed with maintenance when dry-run safety passes.
  const scriptPath = path.join(ROOT, "scripts", "retention-dry-run.js");
  const res = await runNode(scriptPath);
  if (!res.ok || !res.parsed?.ok) {
    throw new Error(`retention dry run failed: ${res.stderr || res.stdout || "unknown"}`);
  }
  const preserves = res.parsed?.safety?.preserves || [];
  const required = ["daily_events", "week_state", "day_state"];
  const missing = required.filter((name) => !preserves.includes(name));
  if (missing.length) {
    throw new Error(`retention safety missing preserves: ${missing.join(", ")}`);
  }
  return res.parsed;
}

async function runDbProfile() {
  const scriptPath = path.join(ROOT, "scripts", "db-profile.js");
  return runNode(scriptPath);
}

async function main() {
  const retention = await runRetentionDryRun();

  await initDb();
  const idempotency = await cleanupIdempotencyKeys(IDEMPOTENCY_RETENTION_DAYS);
  await closeDb();

  let dbProfile = { ok: true, skipped: true, parsed: null };
  if (RUN_DB_PROFILE) {
    dbProfile = await runDbProfile();
  }

  const ok = dbProfile.ok !== false;
  const summary = {
    ok,
    retention,
    idempotency,
    dbProfile: dbProfile.parsed || (dbProfile.skipped ? { skipped: true } : null),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
