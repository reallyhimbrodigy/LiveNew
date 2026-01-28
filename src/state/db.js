import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../db/migrate.js";
import {
  encryptString,
  decryptString,
  hashString,
  normalizeEmail,
  isEncrypted,
} from "../security/crypto.js";

const DB_PATH = process.env.DB_PATH || "data/livenew.sqlite";
let db = null;
const columnCache = new Map();
const queryTracker = new AsyncLocalStorage();

function recordQueryDuration(startMs) {
  const store = queryTracker.getStore();
  if (!store) return;
  store.count += 1;
  store.totalMs += Math.max(0, Date.now() - startMs);
}

function wrapStatement(stmt) {
  const methods = ["run", "get", "all", "iterate"];
  methods.forEach((method) => {
    if (typeof stmt[method] !== "function") return;
    const original = stmt[method].bind(stmt);
    stmt[method] = (...args) => {
      const store = queryTracker.getStore();
      if (!store) return original(...args);
      const start = Date.now();
      try {
        return original(...args);
      } finally {
        recordQueryDuration(start);
      }
    };
  });
  return stmt;
}

function instrumentDb(instance) {
  if (instance.__livenewInstrumented) return;
  const originalPrepare = instance.prepare.bind(instance);
  instance.prepare = (sql) => wrapStatement(originalPrepare(sql));
  const originalExec = instance.exec.bind(instance);
  instance.exec = (sql) => {
    const store = queryTracker.getStore();
    if (!store) return originalExec(sql);
    const start = Date.now();
    try {
      return originalExec(sql);
    } finally {
      recordQueryDuration(start);
    }
  };
  instance.__livenewInstrumented = true;
}

export function runWithQueryTracker(fn) {
  return queryTracker.run({ count: 0, totalMs: 0 }, fn);
}

export function getQueryStats() {
  const store = queryTracker.getStore();
  if (!store) return null;
  return { count: store.count, totalMs: store.totalMs };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
}

export function getDbPath() {
  return DB_PATH;
}

export function getDb() {
  if (!db) throw new Error("DB not initialized");
  return db;
}

function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key);
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all();
  const exists = rows.some((row) => row.name === column);
  columnCache.set(key, exists);
  return exists;
}

export async function initDb() {
  if (db) return db;
  await ensureDir();
  db = new DatabaseSync(DB_PATH);
  instrumentDb(db);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  await runMigrations(db);
  return db;
}

export async function closeDb() {
  if (db && typeof db.close === "function") {
    db.close();
  }
  db = null;
}

export async function checkDbConnection() {
  getDb().prepare("SELECT 1").get();
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

export async function listAppliedMigrations() {
  const rows = getDb()
    .prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id")
    .all();
  return rows.map((row) => ({ id: row.id, appliedAt: row.applied_at }));
}

export async function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  const emailHash = hashString(normalized);
  let row = null;
  if (hasColumn("users", "email_hash") && emailHash) {
    row = getDb().prepare("SELECT id, email, email_hash FROM users WHERE email_hash = ?").get(emailHash);
  }
  if (!row) {
    row = getDb().prepare("SELECT id, email, email_hash FROM users WHERE email = ?").get(normalized);
  }
  if (!row) return null;
  const decrypted = decryptString(row.email);
  if (hasColumn("users", "email_hash") && emailHash) {
    const encrypted = encryptString(decrypted);
    if (row.email_hash !== emailHash || encrypted !== row.email) {
      getDb()
        .prepare("UPDATE users SET email = ?, email_hash = ? WHERE id = ?")
        .run(encrypted, emailHash, row.id);
    }
  }
  return { id: row.id, email: decrypted };
}

export async function getUserById(userId) {
  const row = getDb().prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(userId);
  if (!row) return null;
  return { id: row.id, email: decryptString(row.email), createdAt: row.created_at };
}

export async function createUser(email) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const normalized = normalizeEmail(email);
  const emailHash = hashString(normalized);
  const encrypted = encryptString(normalized);
  if (hasColumn("users", "email_hash")) {
    getDb()
      .prepare("INSERT INTO users (id, email, email_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, encrypted, emailHash, now);
  } else {
    getDb().prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(id, encrypted, now);
  }
  return { id, email: normalized };
}

export async function getOrCreateUser(email) {
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  return createUser(email);
}

export async function createAuthCode(userId, email, code, expiresAtISO) {
  const now = new Date().toISOString();
  const normalized = normalizeEmail(email);
  const emailHash = hashString(normalized);
  const encrypted = encryptString(normalized);
  if (hasColumn("auth_codes", "email_hash")) {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO auth_codes (email, email_hash, code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(encrypted, emailHash, code, userId, expiresAtISO, now);
  } else {
    getDb()
      .prepare("INSERT OR REPLACE INTO auth_codes (email, code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(encrypted, code, userId, expiresAtISO, now);
  }
}

export async function verifyAuthCode(email, code) {
  const normalized = normalizeEmail(email);
  const emailHash = hashString(normalized);
  let row = null;
  if (hasColumn("auth_codes", "email_hash") && emailHash) {
    row = getDb()
      .prepare("SELECT user_id, expires_at FROM auth_codes WHERE email_hash = ? AND code = ?")
      .get(emailHash, code);
  }
  if (!row) {
    row = getDb()
      .prepare("SELECT user_id, expires_at FROM auth_codes WHERE email = ? AND code = ?")
      .get(normalized, code);
  }
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    if (hasColumn("auth_codes", "email_hash") && emailHash) {
      getDb().prepare("DELETE FROM auth_codes WHERE email_hash = ? AND code = ?").run(emailHash, code);
    } else {
      getDb().prepare("DELETE FROM auth_codes WHERE email = ? AND code = ?").run(normalized, code);
    }
    return null;
  }
  if (hasColumn("auth_codes", "email_hash") && emailHash) {
    getDb().prepare("DELETE FROM auth_codes WHERE email_hash = ? AND code = ?").run(emailHash, code);
  } else {
    getDb().prepare("DELETE FROM auth_codes WHERE email = ? AND code = ?").run(normalized, code);
  }
  return { userId: row.user_id };
}

export async function createSession(userId, ttlMinutes = 60 * 24 * 7, deviceName = null) {
  const token = crypto.randomUUID().replace(/-/g, "");
  const tokenHash = hashString(token);
  const encrypted = encryptString(token);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const createdAt = now.toISOString();
  const expiresAt = expires.toISOString();
  const hasTokenHash = hasColumn("sessions", "token_hash");
  const hasDevice = hasColumn("sessions", "device_name");
  const hasLastSeen = hasColumn("sessions", "last_seen_at");

  if (hasTokenHash) {
    if (hasDevice || hasLastSeen) {
      const columns = ["token", "token_hash", "user_id", "expires_at", "created_at"];
      const values = [encrypted, tokenHash, userId, expiresAt, createdAt];
      if (hasDevice) {
        columns.push("device_name");
        values.push(deviceName);
      }
      if (hasLastSeen) {
        columns.push("last_seen_at");
        values.push(createdAt);
      }
      const placeholders = columns.map(() => "?").join(", ");
      getDb().prepare(`INSERT INTO sessions (${columns.join(", ")}) VALUES (${placeholders})`).run(...values);
    } else {
      getDb()
        .prepare("INSERT INTO sessions (token, token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(encrypted, tokenHash, userId, expiresAt, createdAt);
    }
  } else {
    if (hasDevice || hasLastSeen) {
      const columns = ["token", "user_id", "expires_at", "created_at"];
      const values = [encrypted, userId, expiresAt, createdAt];
      if (hasDevice) {
        columns.push("device_name");
        values.push(deviceName);
      }
      if (hasLastSeen) {
        columns.push("last_seen_at");
        values.push(createdAt);
      }
      const placeholders = columns.map(() => "?").join(", ");
      getDb().prepare(`INSERT INTO sessions (${columns.join(", ")}) VALUES (${placeholders})`).run(...values);
    } else {
      getDb()
        .prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(encrypted, userId, expiresAt, createdAt);
    }
  }
  return token;
}

export async function deleteSession(token) {
  const tokenHash = hashString(token);
  if (hasColumn("sessions", "token_hash") && tokenHash) {
    getDb().prepare("DELETE FROM sessions WHERE token_hash = ? OR token = ?").run(tokenHash, token);
  } else {
    getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
}

export async function createRefreshTokenRow({ id, userId, tokenHash, createdAt, expiresAt, deviceName }) {
  getDb()
    .prepare(
      "INSERT INTO refresh_tokens (id, user_id, token_hash, created_at, expires_at, device_name) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, userId, tokenHash, createdAt, expiresAt, deviceName || null);
}

export async function getRefreshTokenByHash(tokenHash) {
  if (!tokenHash) return null;
  return getDb()
    .prepare(
      "SELECT id, user_id, token_hash, created_at, expires_at, revoked_at, replaced_by_id, device_name FROM refresh_tokens WHERE token_hash = ?"
    )
    .get(tokenHash);
}

export async function revokeRefreshTokenById(id) {
  if (!id) return;
  const now = new Date().toISOString();
  getDb().prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?").run(now, id);
}

export async function replaceRefreshToken(oldId, newId) {
  if (!oldId || !newId) return;
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ? WHERE id = ?")
    .run(now, newId, oldId);
}

export async function listRefreshTokensByUser(userId) {
  const rows = getDb()
    .prepare(
      "SELECT id, created_at, expires_at, revoked_at, replaced_by_id, device_name FROM refresh_tokens WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedById: row.replaced_by_id,
    deviceName: row.device_name || null,
  }));
}

export async function updateRefreshTokenDeviceName(id, deviceName) {
  if (!id || !deviceName) return;
  getDb()
    .prepare("UPDATE refresh_tokens SET device_name = COALESCE(device_name, ?) WHERE id = ?")
    .run(deviceName, id);
}

export async function insertPlanChangeSummary({
  id,
  userId,
  dateISO,
  cause,
  fromHistoryId,
  toHistoryId,
  summary,
  createdAt,
}) {
  const summaryId = id || crypto.randomUUID();
  const now = createdAt || new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO plan_change_summaries (id, user_id, date_iso, created_at, cause, from_history_id, to_history_id, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      summaryId,
      userId,
      dateISO,
      now,
      cause,
      fromHistoryId || null,
      toHistoryId || null,
      JSON.stringify(summary || {})
    );
  return { id: summaryId, createdAt: now };
}

export async function listPlanChangeSummaries(userId, dateISO, limit = 10) {
  const size = Math.min(Math.max(limit, 1), 50);
  const rows = getDb()
    .prepare(
      "SELECT id, created_at, cause, summary_json FROM plan_change_summaries WHERE user_id = ? AND date_iso = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, dateISO, size);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    cause: row.cause,
    summary: JSON.parse(row.summary_json),
  }));
}

export async function upsertReminderIntent({ id, userId, dateISO, intentKey, scheduledForISO, status }) {
  const now = new Date().toISOString();
  const intentId = id || crypto.randomUUID();
  getDb()
    .prepare(
      "INSERT INTO reminder_intents (id, user_id, date_iso, intent_key, scheduled_for_iso, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, date_iso, intent_key) DO UPDATE SET scheduled_for_iso=excluded.scheduled_for_iso, status=excluded.status, updated_at=excluded.updated_at"
    )
    .run(
      intentId,
      userId,
      dateISO,
      intentKey,
      scheduledForISO,
      status,
      now,
      now
    );
  return { id: intentId, scheduledForISO, status, updatedAt: now };
}

export async function listReminderIntentsByDate(userId, dateISO) {
  const rows = getDb()
    .prepare(
      "SELECT id, intent_key, scheduled_for_iso, status, created_at, updated_at FROM reminder_intents WHERE user_id = ? AND date_iso = ? ORDER BY scheduled_for_iso ASC"
    )
    .all(userId, dateISO);
  return rows.map((row) => ({
    id: row.id,
    intentKey: row.intent_key,
    scheduledForISO: row.scheduled_for_iso,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listReminderIntentsByRange(userId, fromISO, toISO) {
  if (!userId || !fromISO || !toISO) return [];
  const rows = getDb()
    .prepare(
      "SELECT id, date_iso, intent_key, scheduled_for_iso, status, created_at, updated_at FROM reminder_intents WHERE user_id = ? AND date_iso BETWEEN ? AND ? ORDER BY date_iso ASC, scheduled_for_iso ASC"
    )
    .all(userId, fromISO, toISO);
  return rows.map((row) => ({
    id: row.id,
    dateISO: row.date_iso,
    intentKey: row.intent_key,
    scheduledForISO: row.scheduled_for_iso,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function updateReminderIntentStatus(id, status, userId = null) {
  if (!id) return null;
  const now = new Date().toISOString();
  const stmt = userId
    ? getDb().prepare("UPDATE reminder_intents SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    : getDb().prepare("UPDATE reminder_intents SET status = ?, updated_at = ? WHERE id = ?");
  const result = userId ? stmt.run(status, now, id, userId) : stmt.run(status, now, id);
  if (!result.changes) return null;
  return { id, status, updatedAt: now };
}

export async function listReminderIntentsAdmin({ dateISO, status, page = 1, pageSize = 50 }) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const filters = [];
  const params = [];
  if (dateISO) {
    filters.push("date_iso = ?");
    params.push(dateISO);
  }
  if (status) {
    filters.push("status = ?");
    params.push(status);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT id, user_id, date_iso, intent_key, scheduled_for_iso, status, created_at, updated_at FROM reminder_intents ${where} ORDER BY scheduled_for_iso ASC LIMIT ? OFFSET ?`
    )
    .all(...params, size, offset);
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    dateISO: row.date_iso,
    intentKey: row.intent_key,
    scheduledForISO: row.scheduled_for_iso,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function seedCohorts(cohorts) {
  if (!Array.isArray(cohorts) || !cohorts.length) return;
  const now = new Date().toISOString();
  const stmt = getDb().prepare("INSERT OR IGNORE INTO cohorts (id, name, created_at) VALUES (?, ?, ?)");
  getDb().exec("BEGIN;");
  try {
    cohorts.forEach((cohort) => {
      stmt.run(cohort.id, cohort.name || cohort.id, now);
    });
    getDb().exec("COMMIT;");
  } catch (err) {
    getDb().exec("ROLLBACK;");
    throw err;
  }
}

export async function listCohorts() {
  const rows = getDb().prepare("SELECT id, name, created_at FROM cohorts ORDER BY id ASC").all();
  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}

export async function listCohortParameters(cohortId) {
  const rows = getDb()
    .prepare("SELECT key, value_json, version, updated_at FROM cohort_parameters WHERE cohort_id = ? ORDER BY key")
    .all(cohortId);
  return rows.map((row) => ({
    key: row.key,
    value: JSON.parse(row.value_json),
    version: row.version,
    updatedAt: row.updated_at,
  }));
}

export async function upsertCohortParameter(cohortId, key, value) {
  const now = new Date().toISOString();
  const row = getDb()
    .prepare("SELECT version FROM cohort_parameters WHERE cohort_id = ? AND key = ?")
    .get(cohortId, key);
  const nextVersion = row ? row.version + 1 : 1;
  getDb()
    .prepare(
      "INSERT INTO cohort_parameters (cohort_id, key, value_json, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cohort_id, key) DO UPDATE SET value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at"
    )
    .run(cohortId, key, JSON.stringify(value ?? null), nextVersion, now);
  return { key, version: nextVersion, updatedAt: now };
}

export async function getUserCohort(userId) {
  const row = getDb()
    .prepare("SELECT cohort_id, assigned_at, overridden_by_admin FROM user_cohorts WHERE user_id = ?")
    .get(userId);
  if (!row) return null;
  return {
    cohortId: row.cohort_id,
    assignedAt: row.assigned_at,
    overriddenByAdmin: Boolean(row.overridden_by_admin),
  };
}

export async function setUserCohort(userId, cohortId, overridden = false) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO user_cohorts (user_id, cohort_id, assigned_at, overridden_by_admin) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET cohort_id=excluded.cohort_id, assigned_at=excluded.assigned_at, overridden_by_admin=excluded.overridden_by_admin"
    )
    .run(userId, cohortId, now, overridden ? 1 : 0);
  return { userId, cohortId, assignedAt: now, overriddenByAdmin: overridden };
}

export async function listAllUserStates() {
  const rows = getDb().prepare("SELECT user_id, state_json FROM user_state").all();
  return rows.map((row) => ({ userId: row.user_id, state: JSON.parse(row.state_json) }));
}

export async function cleanupUserRetention(userId, policy) {
  if (!userId || !policy) return;
  const now = Date.now();
  const eventDays = Math.max(1, Number(policy.eventRetentionDays || 0));
  const historyDays = Math.max(1, Number(policy.historyRetentionDays || 0));
  const eventCutoff = new Date(now - eventDays * 86400000).toISOString();
  const historyCutoff = new Date(now - historyDays * 86400000).toISOString();
  getDb().prepare("DELETE FROM user_events WHERE user_id = ? AND at_iso < ?").run(userId, eventCutoff);
  getDb().prepare("DELETE FROM decision_traces WHERE user_id = ? AND created_at < ?").run(userId, historyCutoff);
  getDb().prepare("DELETE FROM day_plan_history WHERE user_id = ? AND created_at < ?").run(userId, historyCutoff);
  getDb().prepare("DELETE FROM plan_change_summaries WHERE user_id = ? AND created_at < ?").run(userId, historyCutoff);
}

export async function deleteSessionByTokenOrHash(value) {
  if (!value) return;
  const tokenHash = value.length >= 64 ? value : hashString(value);
  if (hasColumn("sessions", "token_hash") && tokenHash) {
    getDb().prepare("DELETE FROM sessions WHERE token_hash = ? OR token = ?").run(tokenHash, value);
  } else {
    getDb().prepare("DELETE FROM sessions WHERE token = ?").run(value);
  }
}

export async function touchSession(token, deviceName) {
  const tokenHash = hashString(token);
  const now = new Date().toISOString();
  const hasDevice = hasColumn("sessions", "device_name");
  const hasLastSeen = hasColumn("sessions", "last_seen_at");
  if (!hasDevice && !hasLastSeen) return;
  if (hasColumn("sessions", "token_hash") && tokenHash) {
    if (hasDevice && deviceName) {
      getDb()
        .prepare(
          "UPDATE sessions SET last_seen_at = ?, device_name = COALESCE(device_name, ?) WHERE token_hash = ? OR token = ?"
        )
        .run(now, deviceName, tokenHash, token);
    } else {
      getDb()
        .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? OR token = ?")
        .run(now, tokenHash, token);
    }
    return;
  }
  if (hasDevice && deviceName) {
    getDb()
      .prepare("UPDATE sessions SET last_seen_at = ?, device_name = COALESCE(device_name, ?) WHERE token = ?")
      .run(now, deviceName, token);
  } else {
    getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE token = ?").run(now, token);
  }
}

export async function listSessionsByUser(userId) {
  const hasTokenHash = hasColumn("sessions", "token_hash");
  const hasDevice = hasColumn("sessions", "device_name");
  const hasLastSeen = hasColumn("sessions", "last_seen_at");
  const columns = ["token", "user_id", "expires_at", "created_at"];
  if (hasTokenHash) columns.push("token_hash");
  if (hasDevice) columns.push("device_name");
  if (hasLastSeen) columns.push("last_seen_at");
  const rows = getDb()
    .prepare(`SELECT ${columns.join(", ")} FROM sessions WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId);
  return rows.map((row) => {
    const tokenValue = decryptString(row.token);
    const tokenHash = row.token_hash || hashString(tokenValue);
    return {
      tokenHash,
      deviceName: row.device_name || null,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at || row.created_at,
      expiresAt: row.expires_at,
    };
  });
}

export async function getSession(token) {
  const tokenHash = hashString(token);
  const hasTokenHash = hasColumn("sessions", "token_hash");
  const hasDevice = hasColumn("sessions", "device_name");
  const hasLastSeen = hasColumn("sessions", "last_seen_at");
  const columns = ["sessions.token", "sessions.user_id", "sessions.expires_at", "users.email"];
  if (hasTokenHash) columns.push("sessions.token_hash");
  if (hasDevice) columns.push("sessions.device_name");
  if (hasLastSeen) columns.push("sessions.last_seen_at");
  const selectSql = `SELECT ${columns.join(", ")} FROM sessions JOIN users ON users.id = sessions.user_id WHERE `;
  let row = null;
  if (hasTokenHash && tokenHash) {
    row = getDb()
      .prepare(`${selectSql} sessions.token_hash = ?`)
      .get(tokenHash);
  }
  if (!row) {
    row = getDb()
      .prepare(`${selectSql} sessions.token = ?`)
      .get(token);
  }
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    await deleteSession(token);
    return null;
  }
  if (hasColumn("sessions", "token_hash") && tokenHash && !row.token_hash) {
    const encrypted = encryptString(token);
    getDb().prepare("UPDATE sessions SET token = ?, token_hash = ? WHERE token = ?").run(encrypted, tokenHash, row.token);
  } else if (hasColumn("sessions", "token_hash") && tokenHash && !isEncrypted(row.token)) {
    const encrypted = encryptString(token);
    if (encrypted !== row.token) {
      getDb().prepare("UPDATE sessions SET token = ?, token_hash = ? WHERE token_hash = ?").run(encrypted, tokenHash, tokenHash);
    }
  }
  return {
    token: row.token,
    user_id: row.user_id,
    expires_at: row.expires_at,
    device_name: row.device_name || null,
    last_seen_at: row.last_seen_at || null,
    email: decryptString(row.email),
  };
}

export async function getUserState(userId) {
  const row = getDb().prepare("SELECT state_json, version FROM user_state WHERE user_id = ?").get(userId);
  if (!row) return null;
  return { state: JSON.parse(row.state_json), version: row.version };
}

export async function saveUserState(userId, version, nextState) {
  const now = new Date().toISOString();
  const json = JSON.stringify(nextState);
  const instance = getDb();
  instance.exec("BEGIN;");
  try {
    if (!version) {
      const res = instance
        .prepare("INSERT OR IGNORE INTO user_state (user_id, version, state_json, updated_at) VALUES (?, ?, ?, ?)")
        .run(userId, 1, json, now);
      if (res.changes === 0) {
        instance.exec("ROLLBACK;");
        return { ok: false, conflict: true };
      }
      instance
        .prepare("INSERT INTO user_state_history (user_id, version, state_json, created_at) VALUES (?, ?, ?, ?)")
        .run(userId, 1, json, now);
      pruneHistory(instance, userId);
      instance.exec("COMMIT;");
      return { ok: true, version: 1 };
    }

    const res = instance
      .prepare("UPDATE user_state SET version = ?, state_json = ?, updated_at = ? WHERE user_id = ? AND version = ?")
      .run(version + 1, json, now, userId, version);
    if (res.changes === 0) {
      instance.exec("ROLLBACK;");
      return { ok: false, conflict: true };
    }
    instance
      .prepare("INSERT INTO user_state_history (user_id, version, state_json, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, version + 1, json, now);
    pruneHistory(instance, userId);
    instance.exec("COMMIT;");
    return { ok: true, version: version + 1 };
  } catch (err) {
    instance.exec("ROLLBACK;");
    throw err;
  }
}

function pruneHistory(instance, userId) {
  instance
    .prepare(
      "DELETE FROM user_state_history WHERE user_id = ? AND version NOT IN (SELECT version FROM user_state_history WHERE user_id = ? ORDER BY version DESC LIMIT 50)"
    )
    .run(userId, userId);
}

export async function getUserStateHistory(userId, limit = 50) {
  const rows = getDb()
    .prepare("SELECT version, state_json, created_at FROM user_state_history WHERE user_id = ? ORDER BY version DESC LIMIT ?")
    .all(userId, limit);
  return rows.map((row) => ({
    version: row.version,
    state: JSON.parse(row.state_json),
    createdAt: row.created_at,
  }));
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

export async function getUserEventsRecent(userId, limit = 200) {
  const rows = getDb()
    .prepare(
      "SELECT id, seq, type, payload_json, at_iso, created_at FROM user_events WHERE user_id = ? ORDER BY seq DESC LIMIT ?"
    )
    .all(userId, Math.min(limit, 500));
  return rows
    .map((row) => ({
      id: row.id,
      seq: row.seq,
      type: row.type,
      payload: JSON.parse(row.payload_json),
      atISO: row.at_iso,
      createdAt: row.created_at,
    }))
    .reverse();
}

export async function listUserEventsPaged(userId, page = 1, pageSize = 50) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const rows = getDb()
    .prepare(
      "SELECT id, seq, type, payload_json, at_iso, created_at FROM user_events WHERE user_id = ? ORDER BY seq DESC LIMIT ? OFFSET ?"
    )
    .all(userId, size, offset);
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    atISO: row.at_iso,
    createdAt: row.created_at,
  }));
}

export async function cleanupOldEvents(retentionDays = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const instance = getDb();
  const now = new Date().toISOString();
  instance.exec("BEGIN;");
  try {
    instance.exec(
      `INSERT INTO user_events_archive (id, user_id, seq, type, payload_json, at_iso, created_at, archived_at)
       SELECT id, user_id, seq, type, payload_json, at_iso, created_at, '${now}' FROM user_events WHERE created_at < '${cutoff}'`
    );
    instance.exec(`DELETE FROM user_events WHERE created_at < '${cutoff}'`);
    instance.exec("COMMIT;");
  } catch (err) {
    instance.exec("ROLLBACK;");
    throw err;
  }
}

export async function upsertDecisionTrace(userId, dateISO, trace) {
  const now = new Date().toISOString();
  const hasModelStamp = hasColumn("decision_traces", "model_stamp_json");
  const payload = {
    pipeline_version: trace.pipelineVersion,
    inputs_json: JSON.stringify(trace.inputs),
    stress_state_json: JSON.stringify(trace.stressState),
    selected_json: JSON.stringify(trace.selected),
    applied_rules_json: JSON.stringify(trace.appliedRules),
    rationale_json: JSON.stringify(trace.rationale),
    model_stamp_json: JSON.stringify(trace.modelStamp || null),
  };
  if (hasModelStamp) {
    getDb()
      .prepare(
        "INSERT INTO decision_traces (user_id, date_iso, pipeline_version, inputs_json, stress_state_json, selected_json, applied_rules_json, rationale_json, model_stamp_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, date_iso) DO UPDATE SET pipeline_version=excluded.pipeline_version, inputs_json=excluded.inputs_json, stress_state_json=excluded.stress_state_json, selected_json=excluded.selected_json, applied_rules_json=excluded.applied_rules_json, rationale_json=excluded.rationale_json, model_stamp_json=excluded.model_stamp_json, updated_at=excluded.updated_at"
      )
      .run(
        userId,
        dateISO,
        payload.pipeline_version,
        payload.inputs_json,
        payload.stress_state_json,
        payload.selected_json,
        payload.applied_rules_json,
        payload.rationale_json,
        payload.model_stamp_json,
        now,
        now
      );
  } else {
    getDb()
      .prepare(
        "INSERT INTO decision_traces (user_id, date_iso, pipeline_version, inputs_json, stress_state_json, selected_json, applied_rules_json, rationale_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, date_iso) DO UPDATE SET pipeline_version=excluded.pipeline_version, inputs_json=excluded.inputs_json, stress_state_json=excluded.stress_state_json, selected_json=excluded.selected_json, applied_rules_json=excluded.applied_rules_json, rationale_json=excluded.rationale_json, updated_at=excluded.updated_at"
      )
      .run(
        userId,
        dateISO,
        payload.pipeline_version,
        payload.inputs_json,
        payload.stress_state_json,
        payload.selected_json,
        payload.applied_rules_json,
        payload.rationale_json,
        now,
        now
      );
  }
}

export async function getDecisionTrace(userId, dateISO) {
  const hasModelStamp = hasColumn("decision_traces", "model_stamp_json");
  const row = getDb()
    .prepare(
      `SELECT date_iso, pipeline_version, inputs_json, stress_state_json, selected_json, applied_rules_json, rationale_json${hasModelStamp ? ", model_stamp_json" : ""}, created_at, updated_at FROM decision_traces WHERE user_id = ? AND date_iso = ?`
    )
    .get(userId, dateISO);
  if (!row) return null;
  return {
    userId,
    dateISO: row.date_iso,
    pipelineVersion: row.pipeline_version,
    inputs: JSON.parse(row.inputs_json),
    stressState: JSON.parse(row.stress_state_json),
    selected: JSON.parse(row.selected_json),
    appliedRules: JSON.parse(row.applied_rules_json),
    rationale: JSON.parse(row.rationale_json),
    modelStamp: row.model_stamp_json ? JSON.parse(row.model_stamp_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDecisionTraces(userId, fromISO, toISO, page = 1, pageSize = 50) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const hasModelStamp = hasColumn("decision_traces", "model_stamp_json");
  const rows = getDb()
    .prepare(
      `SELECT date_iso, pipeline_version, inputs_json, stress_state_json, selected_json, applied_rules_json, rationale_json${hasModelStamp ? ", model_stamp_json" : ""}, created_at, updated_at FROM decision_traces WHERE user_id = ? AND date_iso >= ? AND date_iso <= ? ORDER BY date_iso DESC LIMIT ? OFFSET ?`
    )
    .all(userId, fromISO, toISO, size, offset);
  return rows.map((row) => ({
    userId,
    dateISO: row.date_iso,
    pipelineVersion: row.pipeline_version,
    inputs: JSON.parse(row.inputs_json),
    stressState: JSON.parse(row.stress_state_json),
    selected: JSON.parse(row.selected_json),
    appliedRules: JSON.parse(row.applied_rules_json),
    rationale: JSON.parse(row.rationale_json),
    modelStamp: row.model_stamp_json ? JSON.parse(row.model_stamp_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listDecisionTracesRecent(userId, limit = 30) {
  const hasModelStamp = hasColumn("decision_traces", "model_stamp_json");
  const rows = getDb()
    .prepare(
      `SELECT date_iso, pipeline_version, inputs_json, stress_state_json, selected_json, applied_rules_json, rationale_json${hasModelStamp ? ", model_stamp_json" : ""}, created_at, updated_at FROM decision_traces WHERE user_id = ? ORDER BY date_iso DESC LIMIT ?`
    )
    .all(userId, Math.min(limit, 200));
  return rows.map((row) => ({
    dateISO: row.date_iso,
    pipelineVersion: row.pipeline_version,
    inputs: JSON.parse(row.inputs_json),
    stressState: JSON.parse(row.stress_state_json),
    selected: JSON.parse(row.selected_json),
    appliedRules: JSON.parse(row.applied_rules_json),
    rationale: JSON.parse(row.rationale_json),
    modelStamp: row.model_stamp_json ? JSON.parse(row.model_stamp_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function insertDayPlanHistory({ userId, dateISO, cause, dayContract, traceRef, modelStamp = null }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const hasModelStamp = hasColumn("day_plan_history", "model_stamp_json");
  if (hasModelStamp) {
    getDb()
      .prepare(
        "INSERT INTO day_plan_history (id, user_id, date_iso, created_at, cause, day_contract_json, trace_ref, model_stamp_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, userId, dateISO, now, cause, JSON.stringify(dayContract), traceRef || null, JSON.stringify(modelStamp || null));
  } else {
    getDb()
      .prepare(
        "INSERT INTO day_plan_history (id, user_id, date_iso, created_at, cause, day_contract_json, trace_ref) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, userId, dateISO, now, cause, JSON.stringify(dayContract), traceRef || null);
  }
  return { id, createdAt: now };
}

export async function listDayPlanHistory(userId, dateISO, limit = 10) {
  const size = Math.min(Math.max(limit, 1), 50);
  const hasModelStamp = hasColumn("day_plan_history", "model_stamp_json");
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, cause, day_contract_json, trace_ref${hasModelStamp ? ", model_stamp_json" : ""} FROM day_plan_history WHERE user_id = ? AND date_iso = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, dateISO, size);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    cause: row.cause,
    day: JSON.parse(row.day_contract_json),
    traceRef: row.trace_ref,
    modelStamp: row.model_stamp_json ? JSON.parse(row.model_stamp_json) : null,
  }));
}

export async function listLatestDayPlanHistoryByRange(userId, fromISO, toISO) {
  if (!userId || !fromISO || !toISO) return [];
  const hasModelStamp = hasColumn("day_plan_history", "model_stamp_json");
  const rows = getDb()
    .prepare(
      `SELECT h.date_iso, h.created_at, h.day_contract_json${hasModelStamp ? ", h.model_stamp_json" : ""}
       FROM day_plan_history h
       JOIN (
         SELECT date_iso, MAX(created_at) as max_created
         FROM day_plan_history
         WHERE user_id = ? AND date_iso BETWEEN ? AND ?
         GROUP BY date_iso
       ) latest ON h.date_iso = latest.date_iso AND h.created_at = latest.max_created
       WHERE h.user_id = ?
       ORDER BY h.date_iso ASC`
    )
    .all(userId, fromISO, toISO, userId);
  return rows.map((row) => ({
    dateISO: row.date_iso,
    createdAt: row.created_at,
    day: JSON.parse(row.day_contract_json || "{}"),
    modelStamp: row.model_stamp_json ? JSON.parse(row.model_stamp_json) : null,
  }));
}

export async function getDayPlanHistoryById(id) {
  if (!id) return null;
  const hasModelStamp = hasColumn("day_plan_history", "model_stamp_json");
  const row = getDb()
    .prepare(
      `SELECT id, user_id, date_iso, created_at, cause, day_contract_json, trace_ref${hasModelStamp ? ", model_stamp_json" : ""} FROM day_plan_history WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    dateISO: row.date_iso,
    createdAt: row.created_at,
    cause: row.cause,
    day: JSON.parse(row.day_contract_json),
    traceRef: row.trace_ref,
    modelStamp: row.model_stamp_json ? JSON.parse(row.model_stamp_json) : null,
  };
}

const CONTENT_STATUSES_ALL = ["draft", "staged", "enabled", "disabled"];
const CONTENT_STATUS_SET = new Set(CONTENT_STATUSES_ALL);

function normalizeContentStatus(status, fallback = "enabled") {
  const key = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (CONTENT_STATUS_SET.has(key)) return key;
  return fallback;
}

function deriveStatusFromItem(item) {
  if (item?.status) return normalizeContentStatus(item.status);
  if (item?.enabled === false) return "disabled";
  return "enabled";
}

function normalizeStatuses(statuses, includeDisabled) {
  if (Array.isArray(statuses) && statuses.length) {
    const keys = statuses.map((status) => normalizeContentStatus(status, "")).filter(Boolean);
    return Array.from(new Set(keys));
  }
  return includeDisabled ? CONTENT_STATUSES_ALL.slice() : ["enabled"];
}

function augmentContentItem(item, row, hasStatus, hasUpdatedBy) {
  const status = hasStatus ? normalizeContentStatus(row.status, deriveStatusFromItem(item)) : deriveStatusFromItem(item);
  const updatedByAdmin = hasUpdatedBy ? row.updated_by_admin || null : item.updatedByAdmin || null;
  return { ...item, status, updatedByAdmin };
}

function selectContentRows({ kind, statuses, orderBy = "id", limit = null, offset = null }) {
  const hasStatus = hasColumn("content_items", "status");
  const hasUpdatedBy = hasColumn("content_items", "updated_by_admin");
  const cols = ["json"];
  if (hasStatus) cols.push("status");
  if (hasUpdatedBy) cols.push("updated_by_admin");

  const filters = [];
  const params = [];
  if (kind) {
    filters.push("kind = ?");
    params.push(kind);
  }
  if (hasStatus && statuses?.length) {
    const placeholders = statuses.map(() => "?").join(", ");
    filters.push(`status IN (${placeholders})`);
    params.push(...statuses);
  }
  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const limitSql = limit != null ? " LIMIT ? OFFSET ?" : "";
  const sql = `SELECT ${cols.join(", ")} FROM content_items ${whereSql} ORDER BY ${orderBy}${limitSql}`;
  const stmt = getDb().prepare(sql);
  const rows = limit != null ? stmt.all(...params, limit, offset || 0) : stmt.all(...params);
  return { rows, hasStatus, hasUpdatedBy };
}

export async function upsertContentItem(kind, item, options = {}) {
  const id = item.id || crypto.randomUUID();
  const hasStatus = hasColumn("content_items", "status");
  const hasUpdatedBy = hasColumn("content_items", "updated_by_admin");
  const status = normalizeContentStatus(options.status || item.status, deriveStatusFromItem(item));
  const updatedByAdmin = options.updatedByAdmin || item.updatedByAdmin || null;
  const now = new Date().toISOString();
  const payload = { ...item, id, kind, status, updatedByAdmin, updatedAt: now };

  const columns = ["id", "kind", "json", "updated_at"];
  const values = [id, kind, JSON.stringify(payload), now];
  if (hasStatus) {
    columns.push("status");
    values.push(status);
  }
  if (hasUpdatedBy) {
    columns.push("updated_by_admin");
    values.push(updatedByAdmin);
  }
  const placeholders = columns.map(() => "?").join(", ");
  const updates = ["kind=excluded.kind", "json=excluded.json", "updated_at=excluded.updated_at"];
  if (hasStatus) updates.push("status=excluded.status");
  if (hasUpdatedBy) updates.push("updated_by_admin=excluded.updated_by_admin");

  getDb()
    .prepare(
      `INSERT INTO content_items (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`
    )
    .run(...values);

  return payload;
}

export async function getContentItem(kind, id) {
  const hasStatus = hasColumn("content_items", "status");
  const hasUpdatedBy = hasColumn("content_items", "updated_by_admin");
  const cols = ["json"];
  if (hasStatus) cols.push("status");
  if (hasUpdatedBy) cols.push("updated_by_admin");
  const row = getDb()
    .prepare(`SELECT ${cols.join(", ")} FROM content_items WHERE id = ? AND kind = ?`)
    .get(id, kind);
  if (!row) return null;
  const parsed = JSON.parse(row.json);
  return augmentContentItem(parsed, row, hasStatus, hasUpdatedBy);
}

export async function listContentItems(kind, includeDisabled = true, options = {}) {
  const statuses = normalizeStatuses(options.statuses, includeDisabled);
  const { rows, hasStatus, hasUpdatedBy } = selectContentRows({ kind, statuses });
  const items = rows.map((row) => augmentContentItem(JSON.parse(row.json), row, hasStatus, hasUpdatedBy));
  if (includeDisabled) return items;
  return items.filter((item) => item.status === "enabled" && item.enabled !== false);
}

export async function listContentItemsPaged(kind, page = 1, pageSize = 50, options = {}) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const statuses = normalizeStatuses(options.statuses, true);
  const { rows, hasStatus, hasUpdatedBy } = selectContentRows({
    kind,
    statuses,
    orderBy: "id",
    limit: size,
    offset,
  });
  return rows.map((row) => augmentContentItem(JSON.parse(row.json), row, hasStatus, hasUpdatedBy));
}

export async function patchContentItem(kind, id, patch, options = {}) {
  const existing = await getContentItem(kind, id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const statusFromPatch = patch?.status ? normalizeContentStatus(patch.status) : null;
  const derivedStatus = patch?.enabled === false ? "disabled" : null;
  const status = statusFromPatch || options.status || derivedStatus || existing.status || "enabled";
  const updatedByAdmin = options.updatedByAdmin || patch?.updatedByAdmin || existing.updatedByAdmin || null;
  const next = {
    ...existing,
    ...patch,
    id,
    kind,
    status,
    updatedByAdmin,
    updatedAt: now,
  };

  const hasStatus = hasColumn("content_items", "status");
  const hasUpdatedBy = hasColumn("content_items", "updated_by_admin");
  const updates = ["json = ?", "updated_at = ?"];
  const values = [JSON.stringify(next), now];
  if (hasStatus) {
    updates.push("status = ?");
    values.push(status);
  }
  if (hasUpdatedBy) {
    updates.push("updated_by_admin = ?");
    values.push(updatedByAdmin);
  }
  values.push(id, kind);

  getDb()
    .prepare(`UPDATE content_items SET ${updates.join(", ")} WHERE id = ? AND kind = ?`)
    .run(...values);

  return next;
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
  const hasStatus = hasColumn("content_items", "status");
  const hasUpdatedBy = hasColumn("content_items", "updated_by_admin");
  const columns = ["id", "kind", "json", "updated_at"];
  if (hasStatus) columns.push("status");
  if (hasUpdatedBy) columns.push("updated_by_admin");
  const placeholders = columns.map(() => "?").join(", ");
  const stmt = getDb().prepare(`INSERT INTO content_items (${columns.join(", ")}) VALUES (${placeholders})`);
  getDb().exec("BEGIN;");
  try {
    items.forEach(({ kind, item }) => {
      const status = normalizeContentStatus(item?.status, deriveStatusFromItem(item));
      const payload = { ...item, kind, status, updatedAt: now };
      const id = payload.id || crypto.randomUUID();
      payload.id = id;
      const values = [id, kind, JSON.stringify(payload), now];
      if (hasStatus) values.push(status);
      if (hasUpdatedBy) values.push(null);
      stmt.run(...values);
    });
    getDb().exec("COMMIT;");
    return true;
  } catch (err) {
    getDb().exec("ROLLBACK;");
    throw err;
  }
}

export async function seedContentPacks(packs) {
  if (!packs || typeof packs !== "object") return false;
  const count = getDb().prepare("SELECT COUNT(*) as count FROM content_packs").get();
  if (count?.count > 0) return false;
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    "INSERT INTO content_packs (id, name, weights_json, constraints_json, updated_at) VALUES (?, ?, ?, ?, ?)"
  );
  getDb().exec("BEGIN;");
  try {
    Object.entries(packs).forEach(([id, pack]) => {
      const name = pack?.name || id;
      const weights = JSON.stringify(pack?.weights || {});
      const constraints = JSON.stringify(pack?.constraints || {});
      stmt.run(id, name, weights, constraints, now);
    });
    getDb().exec("COMMIT;");
    return true;
  } catch (err) {
    getDb().exec("ROLLBACK;");
    throw err;
  }
}

export async function listContentPacks() {
  const rows = getDb()
    .prepare("SELECT id, name, weights_json, constraints_json, updated_at FROM content_packs ORDER BY id")
    .all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    weights: JSON.parse(row.weights_json || "{}"),
    constraints: JSON.parse(row.constraints_json || "{}"),
    updatedAt: row.updated_at,
  }));
}

export async function getContentPack(id) {
  const row = getDb()
    .prepare("SELECT id, name, weights_json, constraints_json, updated_at FROM content_packs WHERE id = ?")
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    weights: JSON.parse(row.weights_json || "{}"),
    constraints: JSON.parse(row.constraints_json || "{}"),
    updatedAt: row.updated_at,
  };
}

export async function upsertContentPack({ id, name, weights, constraints }) {
  const now = new Date().toISOString();
  const weightsJson = JSON.stringify(weights || {});
  const constraintsJson = JSON.stringify(constraints || {});
  getDb()
    .prepare(
      "INSERT INTO content_packs (id, name, weights_json, constraints_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, weights_json=excluded.weights_json, constraints_json=excluded.constraints_json, updated_at=excluded.updated_at"
    )
    .run(id, name || id, weightsJson, constraintsJson, now);
  return { id, name: name || id, weights: weights || {}, constraints: constraints || {}, updatedAt: now };
}

export function getContentStatuses() {
  return CONTENT_STATUSES_ALL.slice();
}

export async function setContentStatus(kind, id, status, updatedByAdmin = null) {
  const existing = await getContentItem(kind, id);
  if (!existing) return null;
  const nextStatus = normalizeContentStatus(status, existing.status || "enabled");
  const enabled = nextStatus === "disabled" ? false : true;
  return patchContentItem(
    kind,
    id,
    { status: nextStatus, enabled },
    { status: nextStatus, updatedByAdmin }
  );
}

export async function insertContentValidationReport({ kind, scope, report }) {
  const id = crypto.randomUUID();
  const atISO = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO content_validation_reports (id, at_iso, kind, scope, report_json) VALUES (?, ?, ?, ?, ?)")
    .run(id, atISO, kind || "all", scope || "all", JSON.stringify(report || {}));
  return { id, atISO, kind: kind || "all", scope: scope || "all", report };
}

export async function listContentValidationReports({ kind = null, scope = null, limit = 20 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const filters = [];
  const params = [];
  if (kind) {
    filters.push("kind = ?");
    params.push(kind);
  }
  if (scope) {
    filters.push("scope = ?");
    params.push(scope);
  }
  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT id, at_iso, kind, scope, report_json FROM content_validation_reports ${whereSql} ORDER BY at_iso DESC LIMIT ?`)
    .all(...params, lim);
  return rows.map((row) => ({
    id: row.id,
    atISO: row.at_iso,
    kind: row.kind,
    scope: row.scope,
    report: JSON.parse(row.report_json || "{}"),
  }));
}

const EXPERIMENT_STATUSES = new Set(["draft", "running", "stopped"]);

function normalizeExperimentStatus(status, fallback = "draft") {
  const key = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (EXPERIMENT_STATUSES.has(key)) return key;
  return fallback;
}

function parseExperimentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    config: JSON.parse(row.config_json || "{}"),
  };
}

export async function listExperiments(status = null) {
  const nextStatus = status ? normalizeExperimentStatus(status, "") : null;
  const rows = nextStatus
    ? getDb()
        .prepare("SELECT id, name, status, created_at, updated_at, config_json FROM experiments WHERE status = ? ORDER BY updated_at DESC")
        .all(nextStatus)
    : getDb()
        .prepare("SELECT id, name, status, created_at, updated_at, config_json FROM experiments ORDER BY updated_at DESC")
        .all();
  return rows.map(parseExperimentRow);
}

export async function listRunningExperiments() {
  return listExperiments("running");
}

export async function getExperiment(id) {
  const row = getDb()
    .prepare("SELECT id, name, status, created_at, updated_at, config_json FROM experiments WHERE id = ?")
    .get(id);
  return parseExperimentRow(row);
}

export async function createExperiment({ name, config, status = "draft" }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const nextStatus = normalizeExperimentStatus(status, "draft");
  getDb()
    .prepare("INSERT INTO experiments (id, name, status, created_at, updated_at, config_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, name, nextStatus, now, now, JSON.stringify(config || {}));
  return { id, name, status: nextStatus, createdAt: now, updatedAt: now, config: config || {} };
}

export async function updateExperiment(id, patch = {}) {
  const existing = await getExperiment(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...patch,
    id,
    status: patch.status ? normalizeExperimentStatus(patch.status, existing.status) : existing.status,
    updatedAt: now,
  };
  getDb()
    .prepare("UPDATE experiments SET name = ?, status = ?, updated_at = ?, config_json = ? WHERE id = ?")
    .run(next.name, next.status, now, JSON.stringify(next.config || {}), id);
  return next;
}

export async function setExperimentStatus(id, status) {
  return updateExperiment(id, { status: normalizeExperimentStatus(status, "draft") });
}

export async function getExperimentAssignment(experimentId, userId) {
  const row = getDb()
    .prepare("SELECT experiment_id, user_id, variant_key, assigned_at FROM experiment_assignments WHERE experiment_id = ? AND user_id = ?")
    .get(experimentId, userId);
  if (!row) return null;
  return {
    experimentId: row.experiment_id,
    userId: row.user_id,
    variantKey: row.variant_key,
    assignedAt: row.assigned_at,
  };
}

export async function upsertExperimentAssignment(experimentId, userId, variantKey) {
  const existing = await getExperimentAssignment(experimentId, userId);
  if (existing) return existing;
  const assignedAt = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO experiment_assignments (experiment_id, user_id, variant_key, assigned_at) VALUES (?, ?, ?, ?)"
    )
    .run(experimentId, userId, variantKey, assignedAt);
  return getExperimentAssignment(experimentId, userId);
}

export async function listExperimentAssignments(experimentId, page = 1, pageSize = 50) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const rows = getDb()
    .prepare(
      "SELECT experiment_id, user_id, variant_key, assigned_at FROM experiment_assignments WHERE experiment_id = ? ORDER BY assigned_at DESC LIMIT ? OFFSET ?"
    )
    .all(experimentId, size, offset);
  return rows.map((row) => ({
    experimentId: row.experiment_id,
    userId: row.user_id,
    variantKey: row.variant_key,
    assignedAt: row.assigned_at,
  }));
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

export async function listUserContentPrefs(userId) {
  if (!userId) return [];
  const rows = getDb()
    .prepare("SELECT user_id, item_id, pref, created_at FROM user_content_prefs WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId);
  return rows.map((row) => ({
    userId: row.user_id,
    itemId: row.item_id,
    pref: row.pref,
    createdAt: row.created_at,
  }));
}

export async function upsertUserContentPref(userId, itemId, pref) {
  if (!userId || !itemId || !pref) return null;
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO user_content_prefs (user_id, item_id, pref, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET pref=excluded.pref, created_at=excluded.created_at"
    )
    .run(userId, itemId, pref, createdAt);
  return { userId, itemId, pref, createdAt };
}

export async function deleteUserContentPref(userId, itemId) {
  if (!userId || !itemId) return false;
  const res = getDb().prepare("DELETE FROM user_content_prefs WHERE user_id = ? AND item_id = ?").run(userId, itemId);
  return res.changes > 0;
}

export async function insertContentFeedback({ userId, itemId, kind, reasonCode, dateISO, atISO = null }) {
  if (!userId || !itemId || !kind || !reasonCode || !dateISO) return null;
  const id = crypto.randomUUID();
  const atIso = atISO || new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO content_feedback (id, user_id, item_id, kind, reason_code, at_iso, date_iso) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, userId, itemId, kind, reasonCode, atIso, dateISO);
  return { id, userId, itemId, kind, reasonCode, atISO: atIso, dateISO };
}

export async function getContentSnapshot(snapshotId) {
  if (!snapshotId) return null;
  const row = getDb()
    .prepare(
      "SELECT id, created_at, created_by_admin, note, library_hash, packs_hash, params_hash, status, released_at, rolled_back_at FROM content_snapshots WHERE id = ?"
    )
    .get(snapshotId);
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    createdByAdmin: row.created_by_admin,
    note: row.note,
    libraryHash: row.library_hash,
    packsHash: row.packs_hash,
    paramsHash: row.params_hash,
    status: row.status,
    releasedAt: row.released_at,
    rolledBackAt: row.rolled_back_at,
  };
}

export async function listContentSnapshots({ status = null, limit = 50 } = {}) {
  const size = Math.min(Math.max(limit, 1), 200);
  if (status) {
    return getDb()
      .prepare(
        "SELECT id, created_at, created_by_admin, note, library_hash, packs_hash, params_hash, status, released_at, rolled_back_at FROM content_snapshots WHERE status = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(status, size)
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        createdByAdmin: row.created_by_admin,
        note: row.note,
        libraryHash: row.library_hash,
        packsHash: row.packs_hash,
        paramsHash: row.params_hash,
        status: row.status,
        releasedAt: row.released_at,
        rolledBackAt: row.rolled_back_at,
      }));
  }
  return getDb()
    .prepare(
      "SELECT id, created_at, created_by_admin, note, library_hash, packs_hash, params_hash, status, released_at, rolled_back_at FROM content_snapshots ORDER BY created_at DESC LIMIT ?"
    )
    .all(size)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      createdByAdmin: row.created_by_admin,
      note: row.note,
      libraryHash: row.library_hash,
      packsHash: row.packs_hash,
      paramsHash: row.params_hash,
      status: row.status,
      releasedAt: row.released_at,
      rolledBackAt: row.rolled_back_at,
    }));
}

export async function getLatestReleasedSnapshot() {
  const row = getDb()
    .prepare(
      "SELECT id, created_at, created_by_admin, note, library_hash, packs_hash, params_hash, status, released_at, rolled_back_at FROM content_snapshots WHERE status = 'released' ORDER BY released_at DESC, created_at DESC LIMIT 1"
    )
    .get();
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    createdByAdmin: row.created_by_admin,
    note: row.note,
    libraryHash: row.library_hash,
    packsHash: row.packs_hash,
    paramsHash: row.params_hash,
    status: row.status,
    releasedAt: row.released_at,
    rolledBackAt: row.rolled_back_at,
  };
}

export async function getLatestSnapshotIdForPrefix(prefix) {
  if (!prefix) return null;
  const row = getDb()
    .prepare("SELECT id FROM content_snapshots WHERE id LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`${prefix}%`);
  return row?.id || null;
}

export async function insertContentSnapshot({ id, createdByAdmin, note, libraryHash, packsHash, paramsHash, status = "draft", createdAt = null }) {
  if (!id) return null;
  const now = createdAt || new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO content_snapshots (id, created_at, created_by_admin, note, library_hash, packs_hash, params_hash, status, released_at, rolled_back_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)"
    )
    .run(id, now, createdByAdmin, note || null, libraryHash, packsHash, paramsHash, status);
  return { id, createdAt: now, createdByAdmin, note: note || null, libraryHash, packsHash, paramsHash, status };
}

export async function insertContentSnapshotItems(snapshotId, items = []) {
  if (!snapshotId || !items.length) return 0;
  const stmt = getDb().prepare(
    "INSERT INTO content_snapshot_items (snapshot_id, kind, item_id, item_json) VALUES (?, ?, ?, ?)"
  );
  let count = 0;
  items.forEach((item) => {
    stmt.run(snapshotId, item.kind, item.itemId, JSON.stringify(item.item));
    count += 1;
  });
  return count;
}

export async function insertContentSnapshotPacks(snapshotId, packs = []) {
  if (!snapshotId || !packs.length) return 0;
  const stmt = getDb().prepare(
    "INSERT INTO content_snapshot_packs (snapshot_id, pack_id, pack_json) VALUES (?, ?, ?)"
  );
  let count = 0;
  packs.forEach((pack) => {
    stmt.run(snapshotId, pack.packId, JSON.stringify(pack.pack));
    count += 1;
  });
  return count;
}

export async function insertContentSnapshotParams(snapshotId, params = []) {
  if (!snapshotId || !params.length) return 0;
  const stmt = getDb().prepare(
    "INSERT INTO content_snapshot_params (snapshot_id, key, value_json, version) VALUES (?, ?, ?, ?)"
  );
  let count = 0;
  params.forEach((param) => {
    stmt.run(snapshotId, param.key, JSON.stringify(param.value), Number(param.version) || 0);
    count += 1;
  });
  return count;
}

export async function createContentSnapshot({ id, createdByAdmin, note, libraryHash, packsHash, paramsHash, items, packs, params }) {
  const instance = getDb();
  instance.exec("BEGIN;");
  try {
    const snapshot = await insertContentSnapshot({ id, createdByAdmin, note, libraryHash, packsHash, paramsHash, status: "draft" });
    await insertContentSnapshotItems(id, items || []);
    await insertContentSnapshotPacks(id, packs || []);
    await insertContentSnapshotParams(id, params || []);
    instance.exec("COMMIT;");
    return snapshot;
  } catch (err) {
    instance.exec("ROLLBACK;");
    throw err;
  }
}

export async function updateContentSnapshotStatus({ snapshotId, status, releasedAt = null, rolledBackAt = null }) {
  if (!snapshotId || !status) return null;
  getDb()
    .prepare(
      "UPDATE content_snapshots SET status = ?, released_at = ?, rolled_back_at = ? WHERE id = ?"
    )
    .run(status, releasedAt, rolledBackAt, snapshotId);
  return getContentSnapshot(snapshotId);
}

export async function listContentSnapshotItems(snapshotId) {
  if (!snapshotId) return [];
  const rows = getDb()
    .prepare("SELECT kind, item_id, item_json FROM content_snapshot_items WHERE snapshot_id = ? ORDER BY kind, item_id")
    .all(snapshotId);
  return rows.map((row) => ({
    kind: row.kind,
    itemId: row.item_id,
    item: JSON.parse(row.item_json),
  }));
}

export async function listContentSnapshotPacks(snapshotId) {
  if (!snapshotId) return [];
  const rows = getDb()
    .prepare("SELECT pack_id, pack_json FROM content_snapshot_packs WHERE snapshot_id = ? ORDER BY pack_id")
    .all(snapshotId);
  return rows.map((row) => ({
    packId: row.pack_id,
    pack: JSON.parse(row.pack_json),
  }));
}

export async function listContentSnapshotParams(snapshotId) {
  if (!snapshotId) return [];
  const rows = getDb()
    .prepare("SELECT key, value_json, version FROM content_snapshot_params WHERE snapshot_id = ? ORDER BY key")
    .all(snapshotId);
  return rows.map((row) => ({
    key: row.key,
    value: JSON.parse(row.value_json),
    version: row.version,
  }));
}

export async function getSnapshotMeta(key) {
  if (!key) return null;
  const row = getDb().prepare("SELECT value FROM content_snapshot_meta WHERE key = ?").get(key);
  return row?.value || null;
}

export async function upsertSnapshotMeta(key, value) {
  if (!key || value == null) return null;
  getDb()
    .prepare(
      "INSERT INTO content_snapshot_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, String(value));
  return { key, value: String(value) };
}

export async function getUserSnapshotPin(userId) {
  if (!userId) return null;
  const row = getDb()
    .prepare(
      "SELECT user_id, snapshot_id, pinned_at, pin_expires_at, reason FROM user_snapshot_pins WHERE user_id = ?"
    )
    .get(userId);
  if (!row) return null;
  return {
    userId: row.user_id,
    snapshotId: row.snapshot_id,
    pinnedAt: row.pinned_at,
    pinExpiresAt: row.pin_expires_at,
    reason: row.reason,
  };
}

export async function upsertUserSnapshotPin({ userId, snapshotId, pinnedAt, pinExpiresAt, reason }) {
  if (!userId || !snapshotId || !pinExpiresAt || !reason) return null;
  const at = pinnedAt || new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO user_snapshot_pins (user_id, snapshot_id, pinned_at, pin_expires_at, reason) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET snapshot_id=excluded.snapshot_id, pinned_at=excluded.pinned_at, pin_expires_at=excluded.pin_expires_at, reason=excluded.reason"
    )
    .run(userId, snapshotId, at, pinExpiresAt, reason);
  return { userId, snapshotId, pinnedAt: at, pinExpiresAt, reason };
}

export async function getWorstItems(kind, limit = 20) {
  const items = await listContentItems(kind, false, { statuses: ["enabled"] });
  const statsRows = getDb()
    .prepare(
      "SELECT item_id, SUM(picked) as picked, SUM(completed) as completed, SUM(not_relevant) as not_relevant FROM content_stats GROUP BY item_id"
    )
    .all();
  const statsMap = new Map();
  statsRows.forEach((row) => {
    statsMap.set(row.item_id, row);
  });

  const scored = items.map((item) => {
    const stat = statsMap.get(item.id) || { picked: 0, completed: 0, not_relevant: 0 };
    const picked = stat.picked || 0;
    const notRelevantRate = picked ? stat.not_relevant / picked : 0;
    const completionRate = picked ? stat.completed / picked : 0;
    const score = notRelevantRate * 0.7 + (1 - completionRate) * 0.3;
    return {
      item,
      stats: {
        picked,
        completed: stat.completed || 0,
        notRelevant: stat.not_relevant || 0,
        notRelevantRate,
        completionRate,
      },
      score,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
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

export async function recordActiveUser(dateISO, userId) {
  getDb()
    .prepare("INSERT OR IGNORE INTO analytics_active_users (date_iso, user_id) VALUES (?, ?)")
    .run(dateISO, userId);
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM analytics_active_users WHERE date_iso = ?")
    .get(dateISO);
  return row?.count || 0;
}

export async function updateAnalyticsDaily(dateISO, updates) {
  const now = new Date().toISOString();
  const row = getDb().prepare("SELECT * FROM analytics_daily WHERE date_iso = ?").get(dateISO);
  const current = row || {
    date_iso: dateISO,
    checkins_count: 0,
    any_part_days_count: 0,
    feedback_not_relevant_count: 0,
    bad_day_mode_count: 0,
    active_users_count: 0,
    onboard_completed_count: 0,
    first_plan_generated_count: 0,
    first_completion_count: 0,
    day3_retained_count: 0,
    days_with_any_regulation_action_completed: 0,
  };

  const next = {
    checkins_count: current.checkins_count + (updates.checkins_count || 0),
    any_part_days_count: current.any_part_days_count + (updates.any_part_days_count || 0),
    feedback_not_relevant_count: current.feedback_not_relevant_count + (updates.feedback_not_relevant_count || 0),
    bad_day_mode_count: current.bad_day_mode_count + (updates.bad_day_mode_count || 0),
    active_users_count: updates.active_users_count ?? current.active_users_count,
    onboard_completed_count: current.onboard_completed_count + (updates.onboard_completed_count || 0),
    first_plan_generated_count: current.first_plan_generated_count + (updates.first_plan_generated_count || 0),
    first_completion_count: current.first_completion_count + (updates.first_completion_count || 0),
    day3_retained_count: current.day3_retained_count + (updates.day3_retained_count || 0),
    days_with_any_regulation_action_completed:
      current.days_with_any_regulation_action_completed + (updates.days_with_any_regulation_action_completed || 0),
  };

  getDb()
    .prepare(
      "INSERT INTO analytics_daily (date_iso, checkins_count, any_part_days_count, feedback_not_relevant_count, bad_day_mode_count, active_users_count, onboard_completed_count, first_plan_generated_count, first_completion_count, day3_retained_count, days_with_any_regulation_action_completed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date_iso) DO UPDATE SET checkins_count=excluded.checkins_count, any_part_days_count=excluded.any_part_days_count, feedback_not_relevant_count=excluded.feedback_not_relevant_count, bad_day_mode_count=excluded.bad_day_mode_count, active_users_count=excluded.active_users_count, onboard_completed_count=excluded.onboard_completed_count, first_plan_generated_count=excluded.first_plan_generated_count, first_completion_count=excluded.first_completion_count, day3_retained_count=excluded.day3_retained_count, days_with_any_regulation_action_completed=excluded.days_with_any_regulation_action_completed, updated_at=excluded.updated_at"
    )
    .run(
      dateISO,
      next.checkins_count,
      next.any_part_days_count,
      next.feedback_not_relevant_count,
      next.bad_day_mode_count,
      next.active_users_count,
      next.onboard_completed_count,
      next.first_plan_generated_count,
      next.first_completion_count,
      next.day3_retained_count,
      next.days_with_any_regulation_action_completed,
      now
    );
}

export async function listAnalyticsDaily(fromISO, toISO) {
  const rows = getDb()
    .prepare(
      "SELECT date_iso, checkins_count, any_part_days_count, feedback_not_relevant_count, bad_day_mode_count, active_users_count, onboard_completed_count, first_plan_generated_count, first_completion_count, day3_retained_count, days_with_any_regulation_action_completed, updated_at FROM analytics_daily WHERE date_iso >= ? AND date_iso <= ? ORDER BY date_iso DESC"
    )
    .all(fromISO, toISO);
  return rows.map((row) => ({
    dateISO: row.date_iso,
    checkinsCount: row.checkins_count,
    anyPartDaysCount: row.any_part_days_count,
    feedbackNotRelevantCount: row.feedback_not_relevant_count,
    badDayModeCount: row.bad_day_mode_count,
    activeUsersCount: row.active_users_count,
    onboardCompletedCount: row.onboard_completed_count,
    firstPlanGeneratedCount: row.first_plan_generated_count,
    firstCompletionCount: row.first_completion_count,
    day3RetainedCount: row.day3_retained_count,
    daysWithAnyRegulationActionCompleted: row.days_with_any_regulation_action_completed,
    updatedAt: row.updated_at,
  }));
}

export async function insertAnalyticsEvent({ userId, atISO, dateISO, eventKey, props }) {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      "INSERT INTO analytics_events (id, user_id, at_iso, date_iso, event_key, props_json) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, userId, atISO, dateISO, eventKey, JSON.stringify(props || {}));
  return { id };
}

export async function setAnalyticsDailyFlag(dateISO, userId, flagKey) {
  const info = getDb()
    .prepare("INSERT OR IGNORE INTO analytics_daily_user_flags (date_iso, user_id, flag_key) VALUES (?, ?, ?)")
    .run(dateISO, userId, flagKey);
  return info.changes > 0;
}

export async function countAnalyticsDailyFlags(dateISO, flagKey) {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM analytics_daily_user_flags WHERE date_iso = ? AND flag_key = ?")
    .get(dateISO, flagKey);
  return row?.count || 0;
}

export async function getFirstAnalyticsFlagDate(userId, flagKey) {
  const row = getDb()
    .prepare(
      "SELECT date_iso FROM analytics_daily_user_flags WHERE user_id = ? AND flag_key = ? ORDER BY date_iso ASC LIMIT 1"
    )
    .get(userId, flagKey);
  return row?.date_iso || null;
}

export async function upsertAnalyticsDailyCounts(dateISO, counts) {
  const now = new Date().toISOString();
  const row = getDb().prepare("SELECT * FROM analytics_daily WHERE date_iso = ?").get(dateISO);
  const current = row || {
    date_iso: dateISO,
    checkins_count: 0,
    any_part_days_count: 0,
    feedback_not_relevant_count: 0,
    bad_day_mode_count: 0,
    active_users_count: 0,
    onboard_completed_count: 0,
    first_plan_generated_count: 0,
    first_completion_count: 0,
    day3_retained_count: 0,
    days_with_any_regulation_action_completed: 0,
  };

  const next = {
    checkins_count: current.checkins_count,
    any_part_days_count: current.any_part_days_count,
    feedback_not_relevant_count: current.feedback_not_relevant_count,
    bad_day_mode_count: current.bad_day_mode_count,
    active_users_count: current.active_users_count,
    onboard_completed_count: counts.onboard_completed_count ?? current.onboard_completed_count,
    first_plan_generated_count: counts.first_plan_generated_count ?? current.first_plan_generated_count,
    first_completion_count: counts.first_completion_count ?? current.first_completion_count,
    day3_retained_count: counts.day3_retained_count ?? current.day3_retained_count,
    days_with_any_regulation_action_completed:
      counts.days_with_any_regulation_action_completed ?? current.days_with_any_regulation_action_completed,
  };

  getDb()
    .prepare(
      "INSERT INTO analytics_daily (date_iso, checkins_count, any_part_days_count, feedback_not_relevant_count, bad_day_mode_count, active_users_count, onboard_completed_count, first_plan_generated_count, first_completion_count, day3_retained_count, days_with_any_regulation_action_completed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date_iso) DO UPDATE SET checkins_count=excluded.checkins_count, any_part_days_count=excluded.any_part_days_count, feedback_not_relevant_count=excluded.feedback_not_relevant_count, bad_day_mode_count=excluded.bad_day_mode_count, active_users_count=excluded.active_users_count, onboard_completed_count=excluded.onboard_completed_count, first_plan_generated_count=excluded.first_plan_generated_count, first_completion_count=excluded.first_completion_count, day3_retained_count=excluded.day3_retained_count, days_with_any_regulation_action_completed=excluded.days_with_any_regulation_action_completed, updated_at=excluded.updated_at"
    )
    .run(
      dateISO,
      next.checkins_count,
      next.any_part_days_count,
      next.feedback_not_relevant_count,
      next.bad_day_mode_count,
      next.active_users_count,
      next.onboard_completed_count,
      next.first_plan_generated_count,
      next.first_completion_count,
      next.day3_retained_count,
      next.days_with_any_regulation_action_completed,
      now
    );
}

export async function listParameters() {
  const rows = getDb().prepare("SELECT key, value_json, version, updated_at FROM parameters ORDER BY key").all();
  return rows.map((row) => ({
    key: row.key,
    value: JSON.parse(row.value_json),
    version: row.version,
    updatedAt: row.updated_at,
  }));
}

export async function seedParameters(defaults) {
  if (!defaults || typeof defaults !== "object") return;
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    "INSERT INTO parameters (key, value_json, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING"
  );
  getDb().exec("BEGIN;");
  try {
    Object.entries(defaults).forEach(([key, value]) => {
      stmt.run(key, JSON.stringify(value ?? null), 1, now);
    });
    getDb().exec("COMMIT;");
  } catch (err) {
    getDb().exec("ROLLBACK;");
    throw err;
  }
}

export async function upsertParameter(key, value) {
  const now = new Date().toISOString();
  const row = getDb().prepare("SELECT version FROM parameters WHERE key = ?").get(key);
  const nextVersion = row ? row.version + 1 : 1;
  getDb()
    .prepare(
      "INSERT INTO parameters (key, value_json, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at"
    )
    .run(key, JSON.stringify(value ?? null), nextVersion, now);
  return { key, version: nextVersion, updatedAt: now };
}

export async function seedFeatureFlags(defaults) {
  if (!defaults || typeof defaults !== "object") return false;
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    "INSERT OR IGNORE INTO feature_flags (key, value, updated_at) VALUES (?, ?, ?)"
  );
  Object.entries(defaults).forEach(([key, value]) => {
    stmt.run(key, String(value), now);
  });
  return true;
}

export async function listFeatureFlags() {
  const rows = getDb().prepare("SELECT key, value, updated_at FROM feature_flags").all();
  const flags = {};
  rows.forEach((row) => {
    flags[row.key] = row.value;
  });
  return flags;
}

export async function setFeatureFlag(key, value) {
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO feature_flags (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .run(key, String(value), now);
  return { key, value: String(value), updatedAt: now };
}

export async function insertChangelogEntry({ version, title, notes, audience }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO changelog (id, version, title, notes, audience, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, version, title, notes, audience, createdAt);
  return { id, version, title, notes, audience, createdAt };
}

export async function listChangelogEntries({ audience = null, page = 1, pageSize = 20, limit = null } = {}) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  let rows = [];
  if (limit != null) {
    const lim = Math.min(Math.max(Number(limit) || 1, 1), 50);
    rows = audience
      ? getDb()
          .prepare("SELECT id, version, title, notes, audience, created_at FROM changelog WHERE audience = ? ORDER BY created_at DESC LIMIT ?")
          .all(audience, lim)
      : getDb()
          .prepare("SELECT id, version, title, notes, audience, created_at FROM changelog ORDER BY created_at DESC LIMIT ?")
          .all(lim);
  } else {
    rows = audience
      ? getDb()
          .prepare("SELECT id, version, title, notes, audience, created_at FROM changelog WHERE audience = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
          .all(audience, size, offset)
      : getDb()
          .prepare("SELECT id, version, title, notes, audience, created_at FROM changelog ORDER BY created_at DESC LIMIT ? OFFSET ?")
          .all(size, offset);
  }
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    title: row.title,
    notes: row.notes,
    audience: row.audience,
    createdAt: row.created_at,
  }));
}

function normalizeAttemptEmail(email) {
  return normalizeEmail(email || "");
}

function addMinutesISO(iso, minutes) {
  const base = iso ? new Date(iso) : new Date();
  const next = new Date(base.getTime() + minutes * 60 * 1000);
  return next.toISOString();
}

export async function getAuthAttempt(email) {
  const key = normalizeAttemptEmail(email);
  if (!key) return null;
  const row = getDb()
    .prepare("SELECT email, ip, failures, first_failure_at, locked_until FROM auth_attempts WHERE email = ?")
    .get(key);
  if (!row) return null;
  return {
    email: row.email,
    ip: row.ip,
    failures: row.failures || 0,
    firstFailureAt: row.first_failure_at || null,
    lockedUntil: row.locked_until || null,
  };
}

export async function recordAuthFailure(email, ip, options = {}) {
  const key = normalizeAttemptEmail(email);
  if (!key) return { failures: 0, lockedUntil: null };
  const nowISO = options.nowISO || new Date().toISOString();
  const windowMinutes = options.windowMinutes || 15;
  const lockMinutes = options.lockMinutes || 15;
  const maxFailures = options.maxFailures || 5;
  const windowCutoff = new Date(Date.parse(nowISO) - windowMinutes * 60 * 1000).toISOString();

  const current = await getAuthAttempt(key);
  const withinWindow = current?.firstFailureAt && current.firstFailureAt >= windowCutoff;
  const firstFailureAt = withinWindow ? current.firstFailureAt : nowISO;
  const failures = (withinWindow ? current.failures : 0) + 1;
  const lockedUntil = failures >= maxFailures ? addMinutesISO(nowISO, lockMinutes) : current?.lockedUntil || null;

  getDb()
    .prepare(
      "INSERT INTO auth_attempts (email, ip, failures, first_failure_at, locked_until) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET ip=excluded.ip, failures=excluded.failures, first_failure_at=excluded.first_failure_at, locked_until=excluded.locked_until"
    )
    .run(key, ip || null, failures, firstFailureAt, lockedUntil);

  return { failures, lockedUntil };
}

export async function resetAuthAttempts(email) {
  const key = normalizeAttemptEmail(email);
  if (!key) return false;
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO auth_attempts (email, failures, first_failure_at, locked_until) VALUES (?, 0, NULL, NULL) ON CONFLICT(email) DO UPDATE SET failures = 0, first_failure_at = NULL, locked_until = NULL, ip = NULL")
    .run(key);
  getDb().prepare("UPDATE auth_attempts SET locked_until = NULL WHERE email = ? AND locked_until < ?").run(key, now);
  return true;
}

export async function isAuthLocked(email, nowISO = new Date().toISOString()) {
  const attempt = await getAuthAttempt(email);
  if (!attempt?.lockedUntil) return { locked: false, lockedUntil: null, failures: attempt?.failures || 0 };
  if (attempt.lockedUntil <= nowISO) return { locked: false, lockedUntil: null, failures: attempt.failures || 0 };
  return { locked: true, lockedUntil: attempt.lockedUntil, failures: attempt.failures || 0 };
}

export async function insertAdminAudit({ adminUserId, action, target = null, props = {}, atISO = null }) {
  const id = crypto.randomUUID();
  const atIso = atISO || new Date().toISOString();
  getDb()
    .prepare("INSERT INTO admin_audit (id, at_iso, admin_user_id, action, target, props_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, atIso, adminUserId, action, target, JSON.stringify(props || {}));
  return { id, atISO: atIso };
}

export async function insertOpsLog({ adminUserId, action, target = null, props = {}, atISO = null }) {
  const id = crypto.randomUUID();
  const atIso = atISO || new Date().toISOString();
  getDb()
    .prepare("INSERT INTO ops_log (id, at_iso, admin_user_id, action, target, props_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, atIso, adminUserId, action, target || "", JSON.stringify(props || {}));
  return { id, atISO: atIso };
}

export async function insertOpsRun({ kind, ok, report, atISO = null, id = null }) {
  const runId = id || crypto.randomUUID();
  const atIso = atISO || new Date().toISOString();
  getDb()
    .prepare("INSERT INTO ops_runs (id, kind, at_iso, ok, report_json) VALUES (?, ?, ?, ?, ?)")
    .run(runId, kind, atIso, ok ? 1 : 0, JSON.stringify(report || {}));
  return { id: runId, kind, atISO: atIso, ok: Boolean(ok), report: report || {} };
}

export async function getLatestOpsRun(kind = "loadtest") {
  const row = getDb()
    .prepare("SELECT id, kind, at_iso, ok, report_json FROM ops_runs WHERE kind = ? ORDER BY at_iso DESC LIMIT 1")
    .get(kind);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    atISO: row.at_iso,
    ok: row.ok === 1,
    report: JSON.parse(row.report_json || "{}"),
  };
}

export async function insertDebugBundle({ userId, expiresAt, redacted }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO debug_bundles (id, user_id, created_at, expires_at, redacted_json) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId, createdAt, expiresAt, JSON.stringify(redacted || {}));
  return { id, userId, createdAt, expiresAt };
}

export async function getDebugBundle(id, nowISO = new Date().toISOString()) {
  const row = getDb()
    .prepare("SELECT id, user_id, created_at, expires_at, redacted_json FROM debug_bundles WHERE id = ?")
    .get(id);
  if (!row) return null;
  if (row.expires_at && row.expires_at < nowISO) return null;
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    redacted: JSON.parse(row.redacted_json || "{}"),
  };
}

export async function insertValidatorRun({ kind, ok, report, atISO = null, id = null }) {
  const runId = id || crypto.randomUUID();
  const atIso = atISO || new Date().toISOString();
  getDb()
    .prepare("INSERT INTO validator_runs (id, kind, at_iso, ok, report_json) VALUES (?, ?, ?, ?, ?)")
    .run(runId, kind, atIso, ok ? 1 : 0, JSON.stringify(report || {}));
  return { id: runId, kind, atISO: atIso, ok: Boolean(ok), report: report || {} };
}

export async function getValidatorRun(id) {
  const row = getDb()
    .prepare("SELECT id, kind, at_iso, ok, report_json FROM validator_runs WHERE id = ?")
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    atISO: row.at_iso,
    ok: row.ok === 1,
    report: JSON.parse(row.report_json || "{}"),
  };
}

export async function getLatestValidatorRun(kind = "engine_matrix") {
  const row = getDb()
    .prepare("SELECT id, kind, at_iso, ok, report_json FROM validator_runs WHERE kind = ? ORDER BY at_iso DESC LIMIT 1")
    .get(kind);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    atISO: row.at_iso,
    ok: row.ok === 1,
    report: JSON.parse(row.report_json || "{}"),
  };
}

export async function listValidatorRuns(kind = "engine_matrix", limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const rows = getDb()
    .prepare("SELECT id, kind, at_iso, ok, report_json FROM validator_runs WHERE kind = ? ORDER BY at_iso DESC LIMIT ?")
    .all(kind, safeLimit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    atISO: row.at_iso,
    ok: row.ok === 1,
    report: JSON.parse(row.report_json || "{}"),
  }));
}

export async function cleanupValidatorRuns(kind = "engine_matrix", keep = 50) {
  const safeKeep = Math.max(1, Math.min(Number(keep) || 50, 500));
  getDb()
    .prepare(
      "DELETE FROM validator_runs WHERE kind = ? AND id NOT IN (SELECT id FROM validator_runs WHERE kind = ? ORDER BY at_iso DESC LIMIT ?)"
    )
    .run(kind, kind, safeKeep);
}

export async function listUserConsents(userId) {
  const rows = getDb()
    .prepare("SELECT consent_key, accepted_at, consent_version FROM user_consents WHERE user_id = ?")
    .all(userId);
  const map = {};
  rows.forEach((row) => {
    map[row.consent_key] = {
      acceptedAt: row.accepted_at,
      version: Number(row.consent_version) || 1,
    };
  });
  return map;
}

export async function upsertUserConsents(userId, consentKeys, acceptedAtISO = null, consentVersion = 1) {
  const keys = Array.isArray(consentKeys) ? consentKeys.filter((key) => typeof key === "string" && key.trim()) : [];
  if (!keys.length) return { ok: false, keys: [] };
  const acceptedAt = acceptedAtISO || new Date().toISOString();
  const version = Number(consentVersion) || 1;
  const stmt = getDb().prepare(
    "INSERT INTO user_consents (user_id, consent_key, accepted_at, consent_version) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, consent_key) DO UPDATE SET accepted_at=excluded.accepted_at, consent_version=excluded.consent_version"
  );
  keys.forEach((key) => {
    stmt.run(userId, key.trim(), acceptedAt, version);
  });
  return { ok: true, acceptedAtISO: acceptedAt, keys, version };
}

export async function missingUserConsents(userId, requiredKeys) {
  const required = Array.isArray(requiredKeys) ? requiredKeys.filter((key) => typeof key === "string" && key.trim()) : [];
  if (!required.length) return [];
  const existing = await listUserConsents(userId);
  return required.filter((key) => !existing[key]);
}

export async function getUserConsentVersion(userId) {
  const row = getDb()
    .prepare("SELECT MAX(consent_version) AS version FROM user_consents WHERE user_id = ?")
    .get(userId);
  return Number(row?.version) || 0;
}

export async function getConsentMeta(key) {
  if (!key) return null;
  const row = getDb().prepare("SELECT value FROM consent_meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

export async function setConsentMeta(key, value) {
  if (!key) return null;
  const val = String(value ?? "");
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO consent_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    )
    .run(key, val);
  return { key, value: val, updatedAt: now };
}

export async function setCommunityOptIn(userId, optedIn) {
  const now = new Date().toISOString();
  const value = optedIn ? 1 : 0;
  getDb()
    .prepare("INSERT INTO community_opt_in (user_id, opted_in, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET opted_in=excluded.opted_in, updated_at=excluded.updated_at")
    .run(userId, value, now);
  return { userId, optedIn: Boolean(optedIn), updatedAt: now };
}

export async function getCommunityOptIn(userId) {
  const row = getDb()
    .prepare("SELECT user_id, opted_in, updated_at FROM community_opt_in WHERE user_id = ?")
    .get(userId);
  if (!row) return { userId, optedIn: false, updatedAt: null };
  return { userId, optedIn: row.opted_in === 1, updatedAt: row.updated_at };
}

export async function insertCommunityResponse({ resetItemId, userId, text, status = "pending" }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO community_responses (id, reset_item_id, user_id, created_at, text, status, moderated_by, moderated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)"
    )
    .run(id, resetItemId, userId, createdAt, text, status);
  return { id, resetItemId, userId, createdAt, text, status };
}

export async function listCommunityResponses(resetItemId, status = "approved", limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const rows = getDb()
    .prepare(
      "SELECT id, reset_item_id, created_at, text, status FROM community_responses WHERE reset_item_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(resetItemId, status, safeLimit);
  return rows.map((row) => ({
    id: row.id,
    resetItemId: row.reset_item_id,
    createdAt: row.created_at,
    text: row.text,
    status: row.status,
  }));
}

export async function listCommunityPending(page = 1, pageSize = 50) {
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const rows = getDb()
    .prepare(
      "SELECT id, reset_item_id, user_id, created_at, text, status FROM community_responses WHERE status = 'pending' ORDER BY created_at ASC LIMIT ? OFFSET ?"
    )
    .all(size, offset);
  return rows.map((row) => ({
    id: row.id,
    resetItemId: row.reset_item_id,
    userId: row.user_id,
    createdAt: row.created_at,
    text: row.text,
    status: row.status,
  }));
}

export async function moderateCommunityResponse(id, status, moderatedBy) {
  const moderatedAt = new Date().toISOString();
  const res = getDb()
    .prepare("UPDATE community_responses SET status = ?, moderated_by = ?, moderated_at = ? WHERE id = ?")
    .run(status, moderatedBy || null, moderatedAt, id);
  if (res.changes === 0) return null;
  const row = getDb()
    .prepare("SELECT id, reset_item_id, user_id, created_at, text, status, moderated_by, moderated_at FROM community_responses WHERE id = ?")
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    resetItemId: row.reset_item_id,
    userId: row.user_id,
    createdAt: row.created_at,
    text: row.text,
    status: row.status,
    moderatedBy: row.moderated_by,
    moderatedAt: row.moderated_at,
  };
}

export async function searchUserByEmail(email) {
  const user = await getUserByEmail(email);
  if (!user) return null;
  const userId = user.id;
  const base = await getUserById(userId);
  const cohort = await getUserCohort(userId);
  const state = await getUserState(userId);
  const packId = state?.state?.userProfile?.contentPack || null;
  const lastSeenRow = getDb()
    .prepare(
      "SELECT MAX(ts) as last_seen FROM (SELECT COALESCE(last_seen_at, created_at) as ts FROM sessions WHERE user_id = ? UNION ALL SELECT created_at as ts FROM refresh_tokens WHERE user_id = ?)"
    )
    .get(userId, userId);
  return {
    userId,
    email: base?.email || user.email,
    createdAt: base?.createdAt || null,
    cohortId: cohort?.cohortId || null,
    packId,
    lastSeenAt: lastSeenRow?.last_seen || null,
  };
}

export async function deleteUserData(userId) {
  const instance = getDb();
  const userRow = instance.prepare("SELECT email FROM users WHERE id = ?").get(userId);
  const email = userRow?.email ? decryptString(userRow.email) : null;
  const normalizedEmail = email ? normalizeEmail(email) : null;
  instance.exec("BEGIN;");
  try {
    instance.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM auth_codes WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM user_state WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM user_state_history WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM user_events WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM user_events_archive WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM decision_traces WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM day_plan_history WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM plan_change_summaries WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM content_stats WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM analytics_active_users WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM analytics_daily_user_flags WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM analytics_events WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM reminder_intents WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM user_cohorts WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM experiment_assignments WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM debug_bundles WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM community_responses WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM community_opt_in WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM user_consents WHERE user_id = ?").run(userId);
    instance.prepare("DELETE FROM admin_audit WHERE admin_user_id = ?").run(userId);
    if (normalizedEmail) {
      instance.prepare("DELETE FROM auth_attempts WHERE email = ?").run(normalizedEmail);
    }
    instance.prepare("DELETE FROM users WHERE id = ?").run(userId);
    instance.exec("COMMIT;");
    return { ok: true };
  } catch (err) {
    instance.exec("ROLLBACK;");
    throw err;
  }
}
