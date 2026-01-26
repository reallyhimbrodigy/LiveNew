import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../db/migrate.js";

const DB_PATH = process.env.DB_PATH || "data/livenew.sqlite";
let db = null;

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

export async function initDb() {
  if (db) return db;
  await ensureDir();
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
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

export async function deleteSession(token) {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
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
  const payload = {
    pipeline_version: trace.pipelineVersion,
    inputs_json: JSON.stringify(trace.inputs),
    stress_state_json: JSON.stringify(trace.stressState),
    selected_json: JSON.stringify(trace.selected),
    applied_rules_json: JSON.stringify(trace.appliedRules),
    rationale_json: JSON.stringify(trace.rationale),
  };
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

export async function getDecisionTrace(userId, dateISO) {
  const row = getDb()
    .prepare(
      "SELECT date_iso, pipeline_version, inputs_json, stress_state_json, selected_json, applied_rules_json, rationale_json, created_at, updated_at FROM decision_traces WHERE user_id = ? AND date_iso = ?"
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDecisionTraces(userId, fromISO, toISO, page = 1, pageSize = 50) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const rows = getDb()
    .prepare(
      "SELECT date_iso, pipeline_version, inputs_json, stress_state_json, selected_json, applied_rules_json, rationale_json, created_at, updated_at FROM decision_traces WHERE user_id = ? AND date_iso >= ? AND date_iso <= ? ORDER BY date_iso DESC LIMIT ? OFFSET ?"
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export async function listContentItems(kind, includeDisabled = true) {
  const rows = kind
    ? getDb().prepare("SELECT json FROM content_items WHERE kind = ?").all(kind)
    : getDb().prepare("SELECT json FROM content_items").all();
  const items = rows.map((row) => JSON.parse(row.json));
  if (includeDisabled) return items;
  return items.filter((item) => item.enabled !== false);
}

export async function listContentItemsPaged(kind, page = 1, pageSize = 50) {
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const rows = kind
    ? getDb().prepare("SELECT json FROM content_items WHERE kind = ? ORDER BY id LIMIT ? OFFSET ?").all(kind, size, offset)
    : getDb().prepare("SELECT json FROM content_items ORDER BY id LIMIT ? OFFSET ?").all(size, offset);
  return rows.map((row) => JSON.parse(row.json));
}

export async function patchContentItem(kind, id, patch) {
  const row = getDb().prepare("SELECT json FROM content_items WHERE id = ? AND kind = ?").get(id, kind);
  if (!row) return null;
  const current = JSON.parse(row.json);
  const next = { ...current, ...patch, id, kind };
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE content_items SET json = ?, updated_at = ? WHERE id = ? AND kind = ?")
    .run(JSON.stringify(next), now, id, kind);
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

export async function getWorstItems(kind, limit = 20) {
  const items = await listContentItems(kind, true);
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
  };

  const next = {
    checkins_count: current.checkins_count + (updates.checkins_count || 0),
    any_part_days_count: current.any_part_days_count + (updates.any_part_days_count || 0),
    feedback_not_relevant_count: current.feedback_not_relevant_count + (updates.feedback_not_relevant_count || 0),
    bad_day_mode_count: current.bad_day_mode_count + (updates.bad_day_mode_count || 0),
    active_users_count: updates.active_users_count ?? current.active_users_count,
  };

  getDb()
    .prepare(
      "INSERT INTO analytics_daily (date_iso, checkins_count, any_part_days_count, feedback_not_relevant_count, bad_day_mode_count, active_users_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date_iso) DO UPDATE SET checkins_count=excluded.checkins_count, any_part_days_count=excluded.any_part_days_count, feedback_not_relevant_count=excluded.feedback_not_relevant_count, bad_day_mode_count=excluded.bad_day_mode_count, active_users_count=excluded.active_users_count, updated_at=excluded.updated_at"
    )
    .run(
      dateISO,
      next.checkins_count,
      next.any_part_days_count,
      next.feedback_not_relevant_count,
      next.bad_day_mode_count,
      next.active_users_count,
      now
    );
}

export async function listAnalyticsDaily(fromISO, toISO) {
  const rows = getDb()
    .prepare(
      "SELECT date_iso, checkins_count, any_part_days_count, feedback_not_relevant_count, bad_day_mode_count, active_users_count, updated_at FROM analytics_daily WHERE date_iso >= ? AND date_iso <= ? ORDER BY date_iso DESC"
    )
    .all(fromISO, toISO);
  return rows.map((row) => ({
    dateISO: row.date_iso,
    checkinsCount: row.checkins_count,
    anyPartDaysCount: row.any_part_days_count,
    feedbackNotRelevantCount: row.feedback_not_relevant_count,
    badDayModeCount: row.bad_day_mode_count,
    activeUsersCount: row.active_users_count,
    updatedAt: row.updated_at,
  }));
}
