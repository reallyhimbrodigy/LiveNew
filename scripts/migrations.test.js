import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "data", "migrations_test.sqlite");

async function fileExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  process.env.ENV_MODE = "test";
  process.env.DB_PATH = dbPath;
  const { initDb, closeDb, listAppliedMigrations, checkReady } = await import("../src/state/db.js");
  if (await fileExists(dbPath)) {
    await fs.unlink(dbPath);
  }
  await initDb();
  await checkReady();
  const applied = await listAppliedMigrations();
  if (!applied.length) {
    throw new Error("No migrations applied");
  }
  const migrationsDir = path.join(__dirname, "..", "src", "db", "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .map((name) => name.replace(/\.sql$/, ""))
    .sort();
  const latestApplied = applied[applied.length - 1]?.id || null;
  const latestExpected = files[files.length - 1] || null;
  if (latestApplied !== latestExpected || applied.length < files.length) {
    throw new Error(`Migrations mismatch. expected=${latestExpected} applied=${latestApplied}`);
  }
  await closeDb();
  await fs.unlink(dbPath);
  console.log(JSON.stringify({ ok: true, applied: applied.length }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
