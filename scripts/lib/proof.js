import fs from "fs";
import path from "path";
import { runNode } from "./exec.js";
import { artifactsBaseDir } from "./artifacts.js";

export function loadEnvFile(filePath) {
  const env = {};
  if (!filePath) return env;
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return env;
  }
  raw.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

export function latestArtifact({ subdir, suffix, baseDir = artifactsBaseDir() } = {}) {
  const dir = path.join(baseDir, subdir);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return null;
  }
  const matches = suffix ? files.filter((name) => name.endsWith(suffix)) : files;
  const entries = matches
    .map((name) => {
      const filePath = path.join(dir, name);
      try {
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!entries.length) return null;
  return entries[0];
}

export function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err?.message || "read_json_failed" };
  }
}

export function updatedSince(filePath, sinceMs) {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

export function runScript(scriptPath, { env = {}, args = [] } = {}) {
  return runNode(scriptPath, { env, args });
}
