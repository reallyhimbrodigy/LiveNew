// Runbook: lock retention config after first clean maintenance run.
import fs from "fs";
import path from "path";
import { artifactsBaseDir, ensureDir } from "./lib/artifacts.js";

const BASE = artifactsBaseDir();
const MAINT_DIR = path.join(BASE, "maintenance");
const LOCK_PATH = path.join(MAINT_DIR, "retention-locked.json");

function currentRetentionConfig() {
  const retentionDays = Math.max(1, Number(process.env.RETENTION_DAYS || process.env.EVENT_RETENTION_DAYS || 90));
  const eventRetentionDays = Number(process.env.EVENT_RETENTION_DAYS || retentionDays);
  const idempotencyRetentionDays = Math.max(1, Number(process.env.IDEMPOTENCY_RETENTION_DAYS || 30));
  return { retentionDays, eventRetentionDays, idempotencyRetentionDays };
}

function listMaintenanceArtifacts() {
  try {
    const files = fs.readdirSync(MAINT_DIR).filter((name) => name.endsWith(".json") && name !== "retention-locked.json");
    return files.map((name) => path.join(MAINT_DIR, name));
  } catch {
    return [];
  }
}

function latestPassingArtifact(paths) {
  const entries = paths
    .map((filePath) => {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const stat = fs.statSync(filePath);
        return { filePath, parsed, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries.find((entry) => entry.parsed?.ok === true) || null;
}

function run() {
  if (fs.existsSync(LOCK_PATH)) {
    const existing = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
    console.log(JSON.stringify({ ok: true, locked: true, path: LOCK_PATH, retention: existing?.retention || null }));
    return;
  }

  const artifacts = listMaintenanceArtifacts();
  const latest = latestPassingArtifact(artifacts);
  if (!latest) {
    console.log(JSON.stringify({ ok: false, locked: false, error: "no_passing_maintenance_artifact" }));
    return;
  }

  const retention = currentRetentionConfig();
  ensureDir(MAINT_DIR);
  const payload = {
    ok: true,
    locked: true,
    lockedAt: new Date().toISOString(),
    sourceArtifact: latest.filePath,
    retention,
  };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload));
}

run();
