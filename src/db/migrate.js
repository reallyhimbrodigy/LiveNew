import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
    .sort();
}

export async function runMigrations(db) {
  await ensureMigrationsTable(db);
  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id));
  const files = await listMigrationFiles();

  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    if (applied.has(id)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec("BEGIN;");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        id,
        new Date().toISOString()
      );
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  }
}

export async function rollbackMigration(db, id) {
  await ensureMigrationsTable(db);
  const applied = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(id);
  if (!applied) return { ok: false, reason: "not_applied" };

  const downFile = path.join(MIGRATIONS_DIR, `${id}.down.sql`);
  let sql = null;
  try {
    sql = await fs.readFile(downFile, "utf8");
  } catch {
    return { ok: false, reason: "no_down" };
  }

  db.exec("BEGIN;");
  try {
    db.exec(sql);
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run(id);
    db.exec("COMMIT;");
    return { ok: true };
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function getMigrationsDir() {
  return MIGRATIONS_DIR;
}
