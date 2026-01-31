import fs from "fs";
import path from "path";
import { artifactsBaseDir, ensureDir } from "./artifacts.js";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function writeEvidenceBundle({
  evidenceId,
  type,
  requestId = "",
  scenarioPack = "",
  notes = "",
  extra = null,
  logs = null,
} = {}) {
  if (!evidenceId) return null;
  const base = artifactsBaseDir();
  const dir = path.join(base, "evidence");
  ensureDir(dir);
  const filePath = path.join(dir, `${evidenceId}.json`);
  const existing = readJson(filePath) || { evidenceId, createdAt: new Date().toISOString(), events: [] };
  const event = {
    type: type || "unknown",
    at: new Date().toISOString(),
    requestId,
    scenarioPack,
    notes,
    extra,
  };
  const next = {
    ...existing,
    evidenceId,
    updatedAt: new Date().toISOString(),
    events: Array.isArray(existing.events) ? [...existing.events, event] : [event],
  };
  if (logs && Array.isArray(logs) && logs.length) {
    next.logs = logs;
  }
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
  return filePath;
}
