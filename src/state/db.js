import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.DB_PATH || "data/livenew.sqlite";
let db = null;

const MIGRATIONS = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_state (
        user_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        at_iso TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, seq)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_codes (
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(email, code)
      );
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_stats (
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        picked INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        not_relevant INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(user_id, item_id)
      );
    `,
  },
];

async function ensureDir() {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
}

function getDb() {
  if (!db) throw new Error("DB not initialized");
  return db;
}

export async function initDb() {
  if (db) return db;
  await ensureDir();
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, ran_at TEXT NOT NULL);");

  const applied = new Set(
    db.prepare("SELECT id FROM _migrations").all().map((row) => row.id)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec(migration.sql);
    db.prepare("INSERT INTO _migrations (id, ran_at) VALUES (?, ?)").run(
      migration.id,
      new Date().toISOString()
    );
  }

  return db;
}

export async function checkDbConnection() {
  const instance = getDb();
  instance.prepare("SELECT 1").get();
}

export async function checkReady() {
  const instance = getDb();
  instance.exec("SAVEPOINT readyz;");
  try {
    instance.exec("CREATE TEMP TABLE IF NOT EXISTS readyz_probe (id TEXT);");
    instance.prepare("INSERT INTO readyz_probe (id) VALUES (?)").run("probe");
    instance.exec("ROLLBACK TO readyz;");
    instance.exec("RELEASE readyz;");
  } catch (err) {
    instance.exec("ROLLBACK TO readyz;");
    instance.exec("RELEASE readyz;");
    throw err;
  }
}

export async function getUserByEmail(email) {
  const row = getDb().prepare("SELECT id, email FROM users WHERE email = ?").get(email);
  return row || null;
}

export async function getUserById(userId) {
  const row = getDb().prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
  return row || null;
}

export async function createUser(email) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb().prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(id, email, now);
  return { id, email };
}

export async function getOrCreateUser(email) {
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  return createUser(email);
}

export async function createAuthCode(userId, email, code, expiresAtISO) {
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT OR REPLACE INTO auth_codes (email, code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(email, code, userId, expiresAtISO, now);
}

export async function verifyAuthCode(email, code) {
  const row = getDb()
    .prepare("SELECT user_id, expires_at FROM auth_codes WHERE email = ? AND code = ?")
    .get(email, code);
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    getDb().prepare("DELETE FROM auth_codes WHERE email = ? AND code = ?").run(email, code);
    return null;
  }
  getDb().prepare("DELETE FROM auth_codes WHERE email = ? AND code = ?").run(email, code);
  return { userId: row.user_id };
}

export async function createSession(userId, ttlMinutes = 60 * 24 * 7) {
  const token = crypto.randomUUID().replace(/-/g, "");
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  getDb()
    .prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, expires.toISOString(), now.toISOString());
  return token;
}

export async function getSession(token) {
  const row = getDb()
    .prepare(
      "SELECT sessions.token, sessions.user_id, sessions.expires_at, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?"
    )
    .get(token);
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return row;
}

export async function getUserState(userId) {
  const row = getDb().prepare("SELECT state_json, version FROM user_state WHERE user_id = ?").get(userId);
  if (!row) return null;
  return { state: JSON.parse(row.state_json), version: row.version };
}

export async function saveUserState(userId, version, nextState) {
  const now = new Date().toISOString();
  const json = JSON.stringify(nextState);
  if (version == null) {
    const res = getDb()
      .prepare("INSERT OR IGNORE INTO user_state (user_id, version, state_json, updated_at) VALUES (?, ?, ?, ?)")
      .run(userId, 1, json, now);
    if (res.changes === 0) {
      return { ok: false, conflict: true };
    }
    return { ok: true, version: 1 };
  }
  const res = getDb()
    .prepare("UPDATE user_state SET version = ?, state_json = ?, updated_at = ? WHERE user_id = ? AND version = ?")
    .run(version + 1, json, now, userId, version);
  if (res.changes === 0) {
    return { ok: false, conflict: true };
  }
  return { ok: true, version: version + 1 };
}

export async function appendUserEvent(userId, event) {
  const instance = getDb();
  const now = new Date().toISOString();
  let seq = 0;

  instance.exec("BEGIN IMMEDIATE;");
  try {
    const row = instance
      .prepare("SELECT COALESCE(MAX(seq), 0) as seq FROM user_events WHERE user_id = ?")
      .get(userId);
    seq = (row?.seq || 0) + 1;
    const id = event.id || crypto.randomUUID();
    instance
      .prepare(
        "INSERT INTO user_events (id, user_id, seq, type, payload_json, at_iso, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, userId, seq, event.type, JSON.stringify(event.payload || {}), event.atISO, now);
    instance.exec("COMMIT;");
    return { ...event, id, seq };
  } catch (err) {
    instance.exec("ROLLBACK;");
    throw err;
  }
}

export async function getUserEvents(userId, fromSeq = 1, limit = 200) {
  const rows = getDb()
    .prepare(
      "SELECT id, seq, type, payload_json, at_iso, created_at FROM user_events WHERE user_id = ? AND seq >= ? ORDER BY seq ASC LIMIT ?"
    )
    .all(userId, fromSeq, limit);
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    atISO: row.at_iso,
    createdAt: row.created_at,
  }));
}

export async function upsertContentItem(kind, item) {
  const id = item.id || crypto.randomUUID();
  const payload = { ...item, id, kind };
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO content_items (id, kind, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, json=excluded.json, updated_at=excluded.updated_at"
    )
    .run(id, kind, JSON.stringify(payload), now);
  return payload;
}

export async function listContentItems(kind) {
  const rows = kind
    ? getDb().prepare("SELECT json FROM content_items WHERE kind = ?").all(kind)
    : getDb().prepare("SELECT json FROM content_items").all();
  return rows.map((row) => JSON.parse(row.json));
}

export async function seedContentItems(library) {
  const count = getDb().prepare("SELECT COUNT(*) as count FROM content_items").get();
  if (count?.count > 0) return false;
  const items = [
    ...(library.workouts || []).map((item) => ({ kind: "workout", item })),
    ...(library.nutrition || []).map((item) => ({ kind: "nutrition", item })),
    ...(library.resets || []).map((item) => ({ kind: "reset", item })),
  ];
  const now = new Date().toISOString();
  const stmt = getDb().prepare("INSERT INTO content_items (id, kind, json, updated_at) VALUES (?, ?, ?, ?)");
  getDb().exec("BEGIN;");
  try {
    items.forEach(({ kind, item }) => {
      const payload = { ...item, kind };
      const id = payload.id || crypto.randomUUID();
      payload.id = id;
      stmt.run(id, kind, JSON.stringify(payload), now);
    });
    getDb().exec("COMMIT;");
    return true;
  } catch (err) {
    getDb().exec("ROLLBACK;");
    throw err;
  }
}

export async function bumpContentStats(userId, itemId, field, delta = 1) {
  if (!userId || !itemId) return;
  const column = field === "completed" ? "completed" : field === "not_relevant" ? "not_relevant" : "picked";
  const stmt = getDb().prepare(
    `INSERT INTO content_stats (user_id, item_id, picked, completed, not_relevant)
     VALUES (?, ?, 0, 0, 0)
     ON CONFLICT(user_id, item_id) DO UPDATE SET ${column} = ${column} + ?`
  );
  stmt.run(userId, itemId, delta);
}

export async function getContentStats(userId) {
  const rows = getDb().prepare("SELECT item_id, picked, completed, not_relevant FROM content_stats WHERE user_id = ?").all(userId);
  const stats = {};
  rows.forEach((row) => {
    stats[row.item_id] = {
      picked: row.picked,
      completed: row.completed,
      notRelevant: row.not_relevant,
    };
  });
  return stats;
}

export async function getAdminStats() {
  const rows = getDb().prepare(
    "SELECT item_id, SUM(picked) as picked, SUM(completed) as completed, SUM(not_relevant) as not_relevant FROM content_stats GROUP BY item_id"
  ).all();
  return rows.map((row) => ({
    itemId: row.item_id,
    picked: row.picked || 0,
    completed: row.completed || 0,
    notRelevant: row.not_relevant || 0,
  }));
}

export function getDbPath() {
  return DB_PATH;
}
