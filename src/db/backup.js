import fs from "fs/promises";
import path from "path";
import { getDb, getDbPath, closeDb, initDb } from "../state/db.js";

function backupDir() {
  return path.join(path.dirname(getDbPath()), "backups");
}

export async function createBackup() {
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `db.${stamp}.bak`);
  const db = getDb();
  db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
  return { id: `db.${stamp}.bak`, path: filePath };
}

export async function listBackups() {
  const dir = backupDir();
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((name) => name.endsWith(".bak")).sort().reverse();
  } catch {
    return [];
  }
}

export async function restoreBackup(backupId) {
  const dir = backupDir();
  const filePath = path.join(dir, backupId);
  await fs.access(filePath);
  await closeDb();
  await fs.copyFile(filePath, getDbPath());
  await initDb();
  return { ok: true, backupId };
}
