import http from "http";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import * as domain from "../domain/index.js";
import { reduceEvent } from "../state/engine.js";
import { normalizeState, validateState } from "../domain/schema.js";
import { getScenarioById } from "../dev/scenarios.js";
import { runSnapshotCheck, SNAPSHOT_IDS } from "../dev/snapshot.js";
import { toDayContract } from "./dayContract.js";
import { getUserId, sanitizeUserId } from "./userId.js";
import { sendError } from "./errors.js";
import {
  validateProfile,
  validateCheckIn,
  validateSignal,
  validateFeedback,
  validateComplete,
  validateRules,
  validateReplay,
  validateDateParam,
} from "./validate.js";
import {
  initDb,
  checkDbConnection,
  checkReady,
  getDbPath,
  getUserState,
  saveUserState,
  appendUserEvent,
  getUserEvents,
  getUserEventsRecent,
  listUserEventsPaged,
  getOrCreateUser,
  createAuthCode,
  verifyAuthCode,
  getSession,
  seedContentItems,
  listContentItems,
  listContentItemsPaged,
  patchContentItem,
  upsertContentItem,
  bumpContentStats,
  getContentStats,
  getAdminStats,
  listSessionsByUser,
  touchSession,
  deleteSessionByTokenOrHash,
  updateRefreshTokenDeviceName,
  revokeRefreshTokenById,
  seedParameters,
  cleanupOldEvents,
  upsertDecisionTrace,
  getDecisionTrace,
  listDecisionTraces,
  listDecisionTracesRecent,
  recordActiveUser,
  updateAnalyticsDaily,
  listAnalyticsDaily,
  getUserStateHistory,
  getWorstItems,
  seedFeatureFlags,
  listFeatureFlags,
  setFeatureFlag,
  upsertParameter,
  listAppliedMigrations,
  listRefreshTokensByUser,
  getUserById,
  insertDayPlanHistory,
  listDayPlanHistory,
  getDayPlanHistoryById,
  deleteUserData,
} from "../state/db.js";
import { createBackup, restoreBackup, listBackups } from "../db/backup.js";
import { getConfig } from "./config.js";
import { ensureSecretKey } from "./env.js";
import { computeBootSummary } from "./bootSummary.js";
import { handleSetupRoutes } from "./setupRoutes.js";
import { getParameters, getDefaultParameters, resetParametersCache } from "./parameters.js";
import { createTaskScheduler } from "./tasks.js";
import { signAccessToken, verifyAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from "../security/tokens.js";
import { diffDayContracts } from "./diff.js";

const NODE_ENV = process.env.NODE_ENV || "development";
const config = getConfig();
const PORT = config.port;
const isDevRoutesEnabled = config.devRoutesEnabled;
const EVENT_SOURCING = process.env.EVENT_SOURCING === "true";
const EVENT_RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS || 90);
const runtimeAdminEmails = config.adminEmails;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const PUBLIC_DIR = path.join(process.cwd(), "public");

const userStates = new Map();
const MAX_USERS = 50;
const lastSignalByUser = new Map();
const rateLimiters = new Map();
let shuttingDown = false;
const authRateLimiters = new Map();
const readCache = new Map();
const latencySamples = new Map();
const featureFlagsCache = { data: null, loadedAt: 0 };
const FEATURE_FLAGS_TTL_MS = 10 * 1000;
const DEFAULT_FLAGS = {
  "rules.constraints.enabled": "true",
  "rules.novelty.enabled": "true",
  "rules.feedback.enabled": "true",
  "rules.badDay.enabled": "true",
  "rules.recoveryDebt.enabled": "true",
  "rules.circadianAnchors.enabled": "true",
  "rules.safety.enabled": "true",
};
const LATENCY_ROUTES = new Set(["GET /v1/plan/day", "POST /v1/checkin", "POST /v1/signal"]);
const ACCESS_TOKEN_TTL_SEC = 15 * 60;

const secretState = ensureSecretKey(config);

await ensureDataDirWritable(config);
await initDb();
await seedContentItems(domain.defaultLibrary);
await seedFeatureFlags(DEFAULT_FLAGS);
await seedParameters(getDefaultParameters());
resetParametersCache();
await applyLibraryFromDb();
await cleanupOldEvents(EVENT_RETENTION_DAYS);
const bootSummary = await computeBootSummary(config);
enforceGuardrails(config, bootSummary);
console.log(JSON.stringify({ boot: bootSummary }));
const taskScheduler = createTaskScheduler({
  config,
  createBackup,
  cleanupOldEvents,
  retentionDays: EVENT_RETENTION_DAYS,
});
taskScheduler.schedule();

function enforceGuardrails(runtimeConfig, summary) {
  if (!(runtimeConfig.isAlphaLike || runtimeConfig.isProdLike)) return;
  const failures = [];
  if (!summary.secretKey.present || summary.secretKey.ephemeral) failures.push("SECRET_KEY");
  if (!summary.admin.configured) failures.push("ADMIN_EMAILS");
  if (summary.devRoutes.enabled) failures.push("DEV_ROUTES_ENABLED");
  if (!summary.csrf.enabled) failures.push("CSRF");
  if (runtimeConfig.requireAuth && !summary.storage.ok) failures.push("DB");
  if (failures.length) {
    throw new Error(
      `ENV_MODE=${runtimeConfig.envMode} requires SECRET_KEY (32+ chars) and ADMIN_EMAILS and CSRF enabled. Refusing to boot.`
    );
  }
}

async function ensureDataDirWritable(runtimeConfig) {
  const dirs = new Set([runtimeConfig.dataDir, path.dirname(getDbPath())]);
  for (const dir of dirs) {
    const testPath = path.join(dir, `.write-test-${process.pid}.tmp`);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(testPath, "ok");
      await fs.unlink(testPath);
    } catch (err) {
      console.error("LiveNew server cannot write to data directory:", dir, err);
      process.exit(1);
    }
  }
}

async function applyLibraryFromDb() {
  const items = await listContentItems(undefined, false);
  if (!items.length) return;
  const workouts = [];
  const nutrition = [];
  const resets = [];
  items.forEach((item) => {
    if (item.kind === "workout") workouts.push(item);
    if (item.kind === "nutrition") nutrition.push(item);
    if (item.kind === "reset") resets.push(item);
  });
  if (workouts.length) domain.defaultLibrary.workouts = workouts;
  if (nutrition.length) domain.defaultLibrary.nutrition = nutrition;
  if (resets.length) domain.defaultLibrary.resets = resets;
  if (typeof domain.setLibraryIndex === "function") {
    domain.setLibraryIndex(domain.defaultLibrary);
  }
}

async function getFeatureFlags() {
  const now = Date.now();
  if (featureFlagsCache.data && now - featureFlagsCache.loadedAt < FEATURE_FLAGS_TTL_MS) {
    return featureFlagsCache.data;
  }
  const loaded = await listFeatureFlags();
  const merged = { ...DEFAULT_FLAGS, ...(loaded || {}) };
  featureFlagsCache.data = merged;
  featureFlagsCache.loadedAt = now;
  return merged;
}

function flagEnabled(flags, key) {
  const value = flags?.[key];
  if (value == null) return true;
  return String(value) !== "false";
}

function resolveRuleToggles(state, flags) {
  const base = {
    constraintsEnabled: flagEnabled(flags, "rules.constraints.enabled"),
    noveltyEnabled: flagEnabled(flags, "rules.novelty.enabled"),
    feedbackEnabled: flagEnabled(flags, "rules.feedback.enabled"),
    badDayEnabled: flagEnabled(flags, "rules.badDay.enabled"),
    recoveryDebtEnabled: flagEnabled(flags, "rules.recoveryDebt.enabled"),
    circadianAnchorsEnabled: flagEnabled(flags, "rules.circadianAnchors.enabled"),
    safetyEnabled: flagEnabled(flags, "rules.safety.enabled"),
  };
  if (!isDevRoutesEnabled) return base;
  const overrides = state.ruleToggles || {};
  return {
    constraintsEnabled: base.constraintsEnabled && overrides.constraintsEnabled !== false,
    noveltyEnabled: base.noveltyEnabled && overrides.noveltyEnabled !== false,
    feedbackEnabled: base.feedbackEnabled && overrides.feedbackEnabled !== false,
    badDayEnabled: base.badDayEnabled && overrides.badDayEnabled !== false,
    recoveryDebtEnabled: base.recoveryDebtEnabled && overrides.recoveryDebtEnabled !== false,
    circadianAnchorsEnabled: base.circadianAnchorsEnabled && overrides.circadianAnchorsEnabled !== false,
    safetyEnabled: base.safetyEnabled && overrides.safetyEnabled !== false,
  };
}

async function repairUserState(userId, reason) {
  const baseNow = new Date().toISOString();
  const events = await getUserEvents(userId, 1, 5000);
  if (events.length) {
    const flags = await getFeatureFlags();
    const paramsState = await getParameters();
    let rebuilt = normalizeState({});
    for (const evt of events) {
      const ctx = {
        domain,
        now: { todayISO: domain.isoToday(), atISO: evt.atISO || baseNow },
        ruleToggles: resolveRuleToggles(rebuilt, flags),
        scenarios: { getScenarioById },
        isDev: isDevRoutesEnabled,
        params: paramsState.map,
      };
      const result = reduceEvent(rebuilt, { type: evt.type, payload: evt.payload, atISO: evt.atISO || baseNow }, ctx);
      rebuilt = appendLogEvent(result.nextState, result.logEvent);
    }
    try {
      validateState(rebuilt);
      const latest = await getUserState(userId);
      const saveRes = await saveUserState(userId, latest?.version || 0, rebuilt);
      if (saveRes.ok) {
        updateUserCache(userId, rebuilt, saveRes.version);
        console.log(
          JSON.stringify({ atISO: baseNow, event: "auto_repair", userId, reason: reason || "events_replay" })
        );
        return { ok: true, state: rebuilt };
      }
    } catch {
      // fallthrough to history
    }
  }

  const history = await getUserStateHistory(userId, 50);
  for (const entry of history) {
    try {
      validateState(entry.state);
      const latest = await getUserState(userId);
      const saveRes = await saveUserState(userId, latest?.version || 0, entry.state);
      if (saveRes.ok) {
        updateUserCache(userId, entry.state, saveRes.version);
        console.log(
          JSON.stringify({ atISO: baseNow, event: "auto_repair", userId, reason: reason || "history_fallback" })
        );
        return { ok: true, state: entry.state };
      }
    } catch {
      // continue
    }
  }

  return { ok: false };
}

function evictIfNeeded() {
  if (userStates.size <= MAX_USERS) return;
  let oldestKey = null;
  let oldestAt = Infinity;
  for (const [key, value] of userStates.entries()) {
    if (value.lastAccessAt < oldestAt) {
      oldestAt = value.lastAccessAt;
      oldestKey = key;
    }
  }
  if (oldestKey) userStates.delete(oldestKey);
}

async function loadUserState(userId) {
  const cached = userStates.get(userId);
  if (cached) {
    cached.lastAccessAt = Date.now();
    return cached;
  }
  const snapshot = await getUserState(userId);
  const state = normalizeState(snapshot?.state || {});
  try {
    validateState(state);
  } catch (err) {
    const repaired = await repairUserState(userId, "invalid_snapshot");
    if (repaired.ok) {
      const latest = await getUserState(userId);
      const entry = { state: repaired.state, version: latest?.version || 0, lastAccessAt: Date.now() };
      userStates.set(userId, entry);
      evictIfNeeded();
      return entry;
    }
    throw err;
  }
  const version = snapshot?.version ?? 0;
  const entry = { state, version, lastAccessAt: Date.now() };
  userStates.set(userId, entry);
  evictIfNeeded();
  return entry;
}

function updateUserCache(userId, state, version) {
  userStates.set(userId, { state, version, lastAccessAt: Date.now() });
  evictIfNeeded();
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeUserProfile(profile) {
  if (!profile) return null;
  return {
    ...profile,
    id: profile.id || Math.random().toString(36).slice(2),
    createdAtISO: profile.createdAtISO || domain.isoToday(),
    wakeTime: profile.wakeTime || "07:00",
    bedTime: profile.bedTime || "23:00",
    sleepRegularity: toNumber(profile.sleepRegularity, 5),
    caffeineCupsPerDay: toNumber(profile.caffeineCupsPerDay, 1),
    lateCaffeineDaysPerWeek: toNumber(profile.lateCaffeineDaysPerWeek, 1),
    sunlightMinutesPerDay: toNumber(profile.sunlightMinutesPerDay, 10),
    lateScreenMinutesPerNight: toNumber(profile.lateScreenMinutesPerNight, 45),
    alcoholNightsPerWeek: toNumber(profile.alcoholNightsPerWeek, 1),
    mealTimingConsistency: toNumber(profile.mealTimingConsistency, 5),
    preferredWorkoutWindows: Array.isArray(profile.preferredWorkoutWindows) ? profile.preferredWorkoutWindows : ["PM"],
    busyDays: Array.isArray(profile.busyDays) ? profile.busyDays : [],
    contentPack: profile.contentPack || "balanced_routine",
  };
}

async function seedInitialProfile(email, profile) {
  const normalized = normalizeUserProfile(profile);
  if (!normalized) return;
  const user = await getOrCreateUser(email);
  let cached = await loadUserState(user.id);
  let currentState = cached.state;
  let currentVersion = cached.version;
  const flags = await getFeatureFlags();
  const effectiveToggles = resolveRuleToggles(currentState, flags);
  const paramsState = await getParameters();

  const baseline = dispatch(
    currentState,
    { type: "BASELINE_SAVED", payload: { userProfile: normalized } },
    { ruleToggles: effectiveToggles, params: paramsState.map }
  );
  currentState = baseline.state;
  const ensured = dispatch(currentState, { type: "ENSURE_WEEK", payload: {} }, { ruleToggles: effectiveToggles, params: paramsState.map });
  currentState = ensured.state;

  let saveRes = await saveUserState(user.id, currentVersion, currentState);
  if (!saveRes.ok) {
    cached = await loadUserState(user.id);
    currentState = cached.state;
    currentVersion = cached.version;
    const retryBaseline = dispatch(
      currentState,
      { type: "BASELINE_SAVED", payload: { userProfile: normalized } },
      { ruleToggles: effectiveToggles, params: paramsState.map }
    );
    currentState = retryBaseline.state;
    const retryEnsured = dispatch(currentState, { type: "ENSURE_WEEK", payload: {} }, { ruleToggles: effectiveToggles, params: paramsState.map });
    currentState = retryEnsured.state;
    saveRes = await saveUserState(user.id, currentVersion, currentState);
  }
  if (saveRes.ok) {
    updateUserCache(user.id, currentState, saveRes.version);
  }
}

function appendLogEvent(current, logEvent) {
  if (!logEvent) return current;
  const entries = Array.isArray(logEvent) ? logEvent : [logEvent];
  let nextLog = current.eventLog || [];
  entries.forEach((entry) => {
    if (!entry) return;
    nextLog = [
      {
        id: Math.random().toString(36).slice(2),
        atISO: entry.atISO || new Date().toISOString(),
        type: entry.type,
        payload: entry.payload,
      },
      ...nextLog,
    ].slice(0, 500);
  });
  return { ...current, eventLog: nextLog };
}

function dispatch(state, event, ctxOverrides = {}) {
  const ctx = {
    domain,
    ruleToggles: ctxOverrides.ruleToggles || state.ruleToggles,
    now: { todayISO: domain.isoToday(), atISO: new Date().toISOString() },
    scenarios: { getScenarioById },
    isDev: isDevRoutesEnabled,
    params: ctxOverrides.params,
    ...ctxOverrides,
  };

  const { nextState, effects, logEvent, result } = reduceEvent(state, event, ctx);
  const next = appendLogEvent(nextState, logEvent);
  return { state: next, result, logEvent, effects };
}

function sendJson(res, status, payload, userId) {
  const body = userId ? { userId, ...payload } : { ...payload };
  if (res?.livenewRequestId) body.requestId = res.livenewRequestId;
  const headers = { "Content-Type": "application/json" };
  if (res?.livenewApiVersion) headers["x-api-version"] = res.livenewApiVersion;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function parseJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  chunks.forEach((chunk) => {
    total += chunk.length;
  });
  if (total > 200 * 1024) {
    const err = new Error("Payload too large");
    err.status = 413;
    err.code = "payload_too_large";
    err.field = "body";
    throw err;
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("Invalid JSON body");
    err.status = 400;
    err.code = "bad_json";
    err.field = "body";
    throw err;
  }
}

async function ensureWeekForDate(state, dateISO, dispatchFn) {
  if (!state.userProfile) return state;
  if (!state.weekPlan) {
    const res = await dispatchFn({ type: "ENSURE_WEEK", payload: {} });
    state = res.state;
    if (!state.weekPlan || !dateISO) return state;
  }
  if (dateISO && !state.weekPlan.days.some((d) => d.dateISO === dateISO)) {
    const res = await dispatchFn({ type: "WEEK_REBUILD", payload: { weekAnchorISO: dateISO } });
    return res.state;
  }
  return (await dispatchFn({ type: "ENSURE_WEEK", payload: {} })).state;
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function applyCors(req, res) {
  if (!ALLOWED_ORIGINS.length) return false;
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Device-Name, X-Request-Id, X-Client-Type, X-CSRF-Token"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  return true;
}

function summarizeLibraryItems(items) {
  return (items || []).map((item) => ({
    id: item.id,
    title: item.title,
    tags: item.tags,
    priority: item.priority,
    noveltyGroup: item.noveltyGroup,
  }));
}

function getRequestId(req) {
  const header = req.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && String(value).trim() ? String(value).trim() : crypto.randomUUID();
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

function getDeviceName(req) {
  const header = req.headers["x-device-name"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
}

function isAuthRequired() {
  return config.requireAuth;
}

function parseAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

function isAdmin(email) {
  if (!email) return false;
  return runtimeAdminEmails.has(email.toLowerCase());
}

function addAdminEmail(email) {
  if (!email) return;
  runtimeAdminEmails.add(email.toLowerCase());
}

function isAdminConfigured() {
  return runtimeAdminEmails.size > 0;
}

function getLimiter(userId) {
  if (!rateLimiters.has(userId)) {
    const { general, mutating } = config.rateLimits;
    rateLimiters.set(userId, {
      general: { tokens: general, last: Date.now() },
      mutating: { tokens: mutating, last: Date.now() },
    });
  }
  return rateLimiters.get(userId);
}

function takeToken(bucket, capacity, refillPerMs) {
  const now = Date.now();
  const elapsed = now - bucket.last;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function checkRateLimit(userId, isMutating) {
  const limiter = getLimiter(userId);
  const okGeneral = takeToken(limiter.general, config.rateLimits.general, config.rateLimits.general / 60000);
  if (!okGeneral) return { ok: false, kind: "general" };
  if (isMutating) {
    const okMutating = takeToken(limiter.mutating, config.rateLimits.mutating, config.rateLimits.mutating / 60000);
    if (!okMutating) return { ok: false, kind: "mutating" };
  }
  return { ok: true };
}

function recordLatency(routeKey, ms) {
  if (!LATENCY_ROUTES.has(routeKey)) return;
  const list = latencySamples.get(routeKey) || [];
  list.push(ms);
  if (list.length > 500) list.shift();
  latencySamples.set(routeKey, list);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] * 10) / 10;
}

function latencyStats(routeKey) {
  const samples = latencySamples.get(routeKey) || [];
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
  };
}

function diffSelectionStats(prevStats, nextStats) {
  const diffs = [];
  const categories = ["workouts", "nutrition", "resets"];
  categories.forEach((category) => {
    const prevCat = prevStats?.[category] || {};
    const nextCat = nextStats?.[category] || {};
    const ids = new Set([...Object.keys(prevCat), ...Object.keys(nextCat)]);
    ids.forEach((id) => {
      const prev = prevCat[id] || { picked: 0, completed: 0, notRelevant: 0 };
      const next = nextCat[id] || { picked: 0, completed: 0, notRelevant: 0 };
      const fields = ["picked", "completed", "notRelevant"];
      fields.forEach((field) => {
        const delta = (next[field] || 0) - (prev[field] || 0);
        if (delta > 0) {
          diffs.push({ itemId: id, field, delta });
        }
      });
    });
  });
  return diffs;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const pairs = header.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies = {};
  pairs.forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function issueCsrfToken(res) {
  const token = crypto.randomBytes(16).toString("hex");
  const cookie = `csrf=${token}; HttpOnly; SameSite=Strict; Path=/`;
  res.setHeader("Set-Cookie", cookie);
  return token;
}

function getCsrfToken(req) {
  const cookies = parseCookies(req);
  return cookies.csrf || null;
}

function isApiBypassAllowed(req) {
  const clientType = req.headers["x-client-type"];
  return clientType === "api";
}

function requireCsrf(req, res) {
  if (!config.csrfEnabled) return true;
  const method = req.method || "GET";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const authHeader = parseAuthToken(req);
  if (authHeader) return true;
  if (isApiBypassAllowed(req)) return true;
  const csrfCookie = getCsrfToken(req);
  const csrfHeader = req.headers["x-csrf-token"];
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    sendError(res, 403, "csrf_required", "CSRF token missing or invalid");
    return false;
  }
  return true;
}

function authLimiterKey(type, value) {
  return `${type}:${value || "unknown"}`;
}

function getAuthLimiter(key) {
  if (!authRateLimiters.has(key)) {
    authRateLimiters.set(key, { tokens: config.rateLimits.auth, last: Date.now() });
  }
  return authRateLimiters.get(key);
}

function checkAuthRateLimit(key) {
  const limiter = getAuthLimiter(key);
  const ok = takeToken(limiter, config.rateLimits.auth, config.rateLimits.auth / 60000);
  return ok;
}

function readCacheKey(userId, reqPath, query) {
  return `${userId || "anon"}:${reqPath}?${query || ""}`;
}

function getCachedResponse(userId, reqPath, query) {
  const key = readCacheKey(userId, reqPath, query);
  const entry = readCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    readCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCachedResponse(userId, reqPath, query, payload, ttlMs = config.cacheTTLSeconds * 1000) {
  const key = readCacheKey(userId, reqPath, query);
  readCache.set(key, { payload, expiresAt: Date.now() + ttlMs });
}

function invalidateUserCache(userId) {
  const prefix = `${userId || "anon"}:`;
  for (const key of readCache.keys()) {
    if (key.startsWith(prefix)) readCache.delete(key);
  }
}

function buildDecisionTrace(state, dateISO) {
  const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO);
  if (!dayPlan) return null;
  const checkIn = (state.checkIns || []).find((item) => item.dateISO === dateISO) || null;
  const inputs = {
    checkIn: checkIn
      ? {
          stress: checkIn.stress,
          sleepQuality: checkIn.sleepQuality,
          energy: checkIn.energy,
          timeAvailableMin: checkIn.timeAvailableMin,
        }
      : null,
    modifiers: state.modifiers || {},
    busyDay: Boolean(state.userProfile?.busyDays?.includes?.(dateISO)),
    recoveryDebt: state.lastStressStateByDate?.[dateISO]?.recoveryDebt ?? null,
  };
  return {
    pipelineVersion: dayPlan.pipelineVersion ?? null,
    inputs,
    stressState: state.lastStressStateByDate?.[dateISO] || {},
    selected: dayPlan.meta?.selected || {},
    appliedRules: dayPlan.meta?.appliedRules || [],
    rationale: (dayPlan.rationale || []).slice(0, 3),
  };
}

function findChangedDates(prevState, nextState) {
  const prevDays = prevState.weekPlan?.days || [];
  const nextDays = nextState.weekPlan?.days || [];
  const map = new Map();
  prevDays.forEach((day) => map.set(day.dateISO, JSON.stringify(day)));
  const changed = [];
  nextDays.forEach((day) => {
    const prev = map.get(day.dateISO);
    const next = JSON.stringify(day);
    if (prev !== next) changed.push(day.dateISO);
  });
  return changed;
}

function historyCauseForEvent(eventType) {
  switch (eventType) {
    case "ENSURE_WEEK":
      return "week_generated";
    case "WEEK_REBUILD":
      return "week_rebuild";
    case "CHECKIN_SAVED":
      return "checkin_saved";
    case "QUICK_SIGNAL":
      return "quick_signal";
    case "BAD_DAY_MODE":
      return "bad_day";
    case "FEEDBACK_SUBMITTED":
      return "feedback";
    case "APPLY_SCENARIO":
      return "scenario";
    case "BASELINE_SAVED":
      return "baseline_saved";
    default:
      return "update";
  }
}

function buildTrends(state, days) {
  const todayISO = domain.isoToday();
  const result = [];
  const checkIns = Array.isArray(state.checkIns) ? state.checkIns : [];
  const dayMap = new Map();
  checkIns.forEach((item) => {
    if (!dayMap.has(item.dateISO)) dayMap.set(item.dateISO, []);
    dayMap.get(item.dateISO).push(item);
  });

  for (let i = days - 1; i >= 0; i -= 1) {
    const dateISO = domain.addDaysISO(todayISO, -i);
    const items = dayMap.get(dateISO) || [];
    const stressAvg = items.length
      ? items.reduce((sum, item) => sum + Number(item.stress || 0), 0) / items.length
      : null;
    const sleepAvg = items.length
      ? items.reduce((sum, item) => sum + Number(item.sleepQuality || 0), 0) / items.length
      : null;
    const parts = state.partCompletionByDate?.[dateISO] || {};
    const hasCompletion = Object.keys(parts).length > 0;
    const anyPart = hasCompletion ? Boolean(parts.workout || parts.reset || parts.nutrition) : null;
    const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO);
    const downshiftMinutes = dayPlan
      ? dayPlan.focus === "downshift"
        ? (dayPlan.workout?.minutes || 0) + (dayPlan.reset?.minutes || 0)
        : 0
      : null;

    result.push({
      dateISO,
      stressAvg,
      sleepAvg,
      anyPartCompletion: anyPart,
      downshiftMinutes,
    });
  }
  return result;
}

function assessReadiness(runtimeConfig, summary, checks = {}) {
  const failures = [];
  if (runtimeConfig.dbStatusRequired && !summary.storage.ok) failures.push("db");
  if (!summary.dataDir.writable) failures.push("dataDir");
  if (runtimeConfig.secretKeyPolicy.requireReal && summary.secretKey.ephemeral) failures.push("secretKey");
  if (checks.migrationsOk === false) failures.push("migrations");
  if (checks.flagsOk === false) failures.push("featureFlags");
  if (checks.paramsOk === false) failures.push("parameters");
  if (checks.dbReadyOk === false) failures.push("dbReady");
  if (runtimeConfig.isAlphaLike || runtimeConfig.isProdLike) {
    if (!summary.admin.configured) failures.push("adminEmails");
    if (summary.devRoutes.enabled) failures.push("devRoutes");
    if (!summary.csrf.enabled) failures.push("csrf");
  }
  return { ok: failures.length === 0, failures };
}

function defaultDateRange(days) {
  const toISO = domain.isoToday();
  const fromISO = domain.addDaysISO(toISO, -(days - 1));
  return { fromISO, toISO };
}

async function serveFile(res, filePath, { replaceDevFlag } = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const body = replaceDevFlag ? raw.replace("__IS_DEV__", isDevRoutesEnabled ? "true" : "false") : raw;
    res.writeHead(200, { "Content-Type": contentTypeForPath(filePath) });
    res.end(body);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: "not_found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const requestId = getRequestId(req);
  const started = process.hrtime.bigint();
  res.livenewRequestId = requestId;
  if (pathname.startsWith("/v1")) {
    res.livenewApiVersion = "1";
  }
  const corsApplied = applyCors(req, res);
  if (req.method === "OPTIONS") {
    if (corsApplied) {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const routeKey = `${req.method} ${pathname}`;
    recordLatency(routeKey, durationMs);
    const logEntry = {
      atISO: new Date().toISOString(),
      requestId,
      userId: res.livenewUserId || null,
      route: pathname,
      method: req.method,
      status: res.statusCode,
      ms: Math.round(durationMs),
      errorCode: res.errorCode || undefined,
    };
    console.log(JSON.stringify(logEntry));
  });

  if (shuttingDown) {
    sendError(res, 503, "server_shutting_down", "Server shutting down");
    return;
  }

  const pageRoutes = new Map([
    ["/", "day.html"],
    ["/index.html", "index.html"],
    ["/day", "day.html"],
    ["/day.html", "day.html"],
    ["/week", "week.html"],
    ["/week.html", "week.html"],
    ["/trends", "trends.html"],
    ["/trends.html", "trends.html"],
    ["/profile", "profile.html"],
    ["/profile.html", "profile.html"],
    ["/admin", "admin.html"],
    ["/admin.html", "admin.html"],
  ]);

  if (req.method === "GET" && pageRoutes.has(pathname)) {
    issueCsrfToken(res);
    await serveFile(res, path.join(PUBLIC_DIR, pageRoutes.get(pathname)));
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/assets/")) {
    await serveFile(res, path.join(PUBLIC_DIR, pathname.slice(1)));
    return;
  }

  if (req.method === "GET" && pathname === "/app.js") {
    await serveFile(res, path.join(PUBLIC_DIR, "assets", "app.core.js"));
    return;
  }

  if (req.method === "GET" && pathname === "/styles.css") {
    await serveFile(res, path.join(PUBLIC_DIR, "assets", "styles.css"));
    return;
  }

  if (req.method === "GET" && pathname === "/openapi.v1.json") {
    await serveFile(res, path.join(PUBLIC_DIR, "openapi.v1.json"));
    return;
  }

  if (pathname.startsWith("/dev") || pathname.startsWith("/api") || pathname.startsWith("/v0")) {
    sendError(res, 410, "route_deprecated", "This route is deprecated. Use /v1.");
    return;
  }

  try {
    const handledSetup = await handleSetupRoutes(req, res, config, {
      url,
      sendJson,
      sendError,
      computeSummary: () => computeBootSummary(config),
      isAdminConfigured,
      addAdminEmail,
      seedInitialProfile,
    });
    if (handledSetup) return;

    if (pathname === "/healthz" && req.method === "GET") {
      await checkDbConnection();
      sendJson(res, 200, {
        ok: true,
        versions: {
          pipelineVersion: domain.DECISION_PIPELINE_VERSION ?? null,
          schemaVersion: domain.STATE_SCHEMA_VERSION ?? null,
        },
        uptimeSec: Math.round(process.uptime()),
      });
      return;
    }

    if (pathname === "/readyz" && req.method === "GET") {
      let flagsOk = true;
      let paramsOk = true;
      let migrationsOk = true;
      let dbReadyOk = true;
      let migrationsCount = 0;
      try {
        await checkReady();
      } catch {
        dbReadyOk = false;
      }
      try {
        await getFeatureFlags();
      } catch {
        flagsOk = false;
      }
      let paramsState = null;
      try {
        paramsState = await getParameters();
        paramsOk = paramsState.ok;
      } catch {
        paramsOk = false;
      }
      try {
        const migrations = await listAppliedMigrations();
        migrationsCount = migrations.length;
        migrationsOk = migrations.length > 0;
      } catch {
        migrationsOk = false;
      }
      const summary = await computeBootSummary(config);
      const readiness = assessReadiness(config, summary, { flagsOk, paramsOk, migrationsOk, dbReadyOk });
      sendJson(res, 200, {
        ok: readiness.ok,
        summary,
        failures: readiness.failures,
        checks: {
          flagsOk,
          paramsOk,
          migrationsOk,
          dbReadyOk,
          migrationsCount,
        },
      });
      return;
    }

    if (pathname === "/v1/csrf" && req.method === "GET") {
      const token = issueCsrfToken(res);
      sendJson(res, 200, { ok: true, token });
      return;
    }

    if (pathname === "/v1/auth/request" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const email = body?.email;
      if (!email || typeof email !== "string") {
        sendError(res, 400, "email_required", "email is required", "email");
        return;
      }
      const ip = getClientIp(req);
      if (!checkAuthRateLimit(authLimiterKey("ip", ip))) {
        sendError(res, 429, "rate_limited", "Too many auth attempts");
        return;
      }
      if (!checkAuthRateLimit(authLimiterKey("email", email.toLowerCase()))) {
        sendError(res, 429, "rate_limited", "Too many auth attempts");
        return;
      }
      const user = await getOrCreateUser(email.toLowerCase());
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await createAuthCode(user.id, user.email, code, expiresAt);
      res.livenewUserId = user.id;
      if (isDevRoutesEnabled) {
        sendJson(res, 200, { ok: true, code }, user.id);
      } else {
        console.log(`LiveNew auth code for ${email}: ${code}`);
        sendJson(res, 200, { ok: true }, user.id);
      }
      return;
    }

    if (pathname === "/v1/auth/verify" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const email = body?.email;
      const code = body?.code;
      if (!email || typeof email !== "string") {
        sendError(res, 400, "email_required", "email is required", "email");
        return;
      }
      if (!code || typeof code !== "string") {
        sendError(res, 400, "code_required", "code is required", "code");
        return;
      }
      const ip = getClientIp(req);
      if (!checkAuthRateLimit(authLimiterKey("ip", ip))) {
        sendError(res, 429, "rate_limited", "Too many auth attempts");
        return;
      }
      if (!checkAuthRateLimit(authLimiterKey("email", email.toLowerCase()))) {
        sendError(res, 429, "rate_limited", "Too many auth attempts");
        return;
      }
      const verified = await verifyAuthCode(email.toLowerCase(), code);
      if (!verified) {
        sendError(res, 401, "code_invalid", "code is invalid or expired", "code");
        return;
      }
      const deviceName = getDeviceName(req);
      const refresh = await issueRefreshToken({ userId: verified.userId, deviceName });
      const accessToken = signAccessToken({
        userId: verified.userId,
        scope: "user",
        ttlSec: ACCESS_TOKEN_TTL_SEC,
        sessionId: refresh.refreshTokenId,
      });
      res.livenewUserId = verified.userId;
      sendJson(
        res,
        200,
        {
          ok: true,
          accessToken,
          refreshToken: refresh.refreshToken,
          expiresInSec: ACCESS_TOKEN_TTL_SEC,
          token: accessToken,
        },
        verified.userId
      );
      return;
    }

    let userId = null;
    let userEmail = null;
    let authSessionId = null;
    let usedLegacySession = false;
    const token = parseAuthToken(req);
    if (token) {
      try {
        const verified = verifyAccessToken(token);
        userId = verified.userId;
        authSessionId = verified.sessionId || null;
      } catch {
        const session = await getSession(token);
        if (session) {
          usedLegacySession = true;
          userId = session.user_id;
          userEmail = session.email;
          const deviceName = getDeviceName(req);
          await touchSession(token, deviceName);
        }
      }
    }

    if (pathname === "/v1/auth/refresh" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const refreshToken = body?.refreshToken || body?.token;
      if (!refreshToken || typeof refreshToken !== "string") {
        if (usedLegacySession && token && userId) {
          const deviceName = getDeviceName(req);
          await deleteSessionByTokenOrHash(token);
          const refresh = await issueRefreshToken({ userId, deviceName });
          const accessToken = signAccessToken({
            userId,
            scope: "user",
            ttlSec: ACCESS_TOKEN_TTL_SEC,
            sessionId: refresh.refreshTokenId,
          });
          res.livenewUserId = userId;
          sendJson(
            res,
            200,
            {
              ok: true,
              accessToken,
              refreshToken: refresh.refreshToken,
              expiresInSec: ACCESS_TOKEN_TTL_SEC,
              token: accessToken,
            },
            userId
          );
          return;
        }
        sendError(res, 400, "refresh_required", "refreshToken is required", "refreshToken");
        return;
      }
      let rotated;
      try {
        const deviceName = getDeviceName(req);
        rotated = await rotateRefreshToken(refreshToken, deviceName);
      } catch (err) {
        sendError(res, 401, err.code || "refresh_invalid", err.message || "refresh token invalid");
        return;
      }
      const accessToken = signAccessToken({
        userId: rotated.userId,
        scope: "user",
        ttlSec: ACCESS_TOKEN_TTL_SEC,
        sessionId: rotated.refreshTokenId,
      });
      res.livenewUserId = rotated.userId;
      sendJson(
        res,
        200,
        {
          ok: true,
          accessToken,
          refreshToken: rotated.refreshToken,
          expiresInSec: ACCESS_TOKEN_TTL_SEC,
          token: accessToken,
        },
        rotated.userId
      );
      return;
    }

    if (pathname === "/v1/auth/logout" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const refreshToken = body?.refreshToken || body?.token;
      let revoked = false;
      if (refreshToken && typeof refreshToken === "string") {
        revoked = await revokeRefreshToken(refreshToken);
      } else if (authSessionId) {
        await revokeRefreshTokenById(authSessionId);
        revoked = true;
      } else if (usedLegacySession && token) {
        await deleteSessionByTokenOrHash(token);
        revoked = true;
      }
      if (!revoked) {
        sendError(res, 400, "refresh_required", "refreshToken is required", "refreshToken");
        return;
      }
      sendJson(res, 200, { ok: true }, userId || null);
      return;
    }

    if (!userId) {
      if (isAuthRequired()) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      userId = getUserId(req);
    }

    res.livenewUserId = userId;
    const send = (status, payload) => sendJson(res, status, payload, userId);
    const ensureUserEmail = async () => {
      if (userEmail) return userEmail;
      if (!userId) return null;
      const user = await getUserById(userId);
      userEmail = user?.email || null;
      return userEmail;
    };
    const requireAdmin = async () => {
      const email = await ensureUserEmail();
      if (!email) {
        sendError(res, 401, "auth_required", "Authorization required");
        return null;
      }
      if (!isAdmin(email)) {
        sendError(res, 403, "forbidden", "Admin access required");
        return null;
      }
      return email;
    };

    if (!requireCsrf(req, res)) return;

    const rateKey = userId || "anon";
    const isMutating = !["GET", "HEAD"].includes(req.method);
    const rateCheck = checkRateLimit(rateKey, isMutating);
    if (!rateCheck.ok) {
      sendError(res, 429, "rate_limited", "Too many requests");
      return;
    }

    const cached = await loadUserState(userId);
    let state = cached.state;
    let version = cached.version;

    const dispatchForUser = async (event) => {
      let attempts = 0;
      let currentState = state;
      let currentVersion = version;
      const atISO = event.atISO || new Date().toISOString();
      const eventWithAt = { ...event, atISO };

      while (attempts < 2) {
        const prevStats = currentState.selectionStats;
        const prevState = currentState;
        const flags = await getFeatureFlags();
        const effectiveToggles = resolveRuleToggles(currentState, flags);
        const paramsState = await getParameters();
        const resEvent = dispatch(currentState, eventWithAt, {
          ruleToggles: effectiveToggles,
          params: paramsState.map,
        });
        const nextState = resEvent.state;

        if (!resEvent.effects.persist && !resEvent.logEvent) {
          state = nextState;
          updateUserCache(userId, state, currentVersion);
          return { ...resEvent, state: nextState };
        }

        const saveRes = await saveUserState(userId, currentVersion, nextState);
        if (saveRes.ok) {
          if (EVENT_SOURCING) {
            await appendUserEvent(userId, { type: eventWithAt.type, payload: eventWithAt.payload || {}, atISO });
          }
          const diffs = diffSelectionStats(prevStats, nextState.selectionStats);
          for (const diff of diffs) {
            const field = diff.field === "notRelevant" ? "not_relevant" : diff.field;
            await bumpContentStats(userId, diff.itemId, field, diff.delta);
          }

          const changedDates = findChangedDates(prevState, nextState);
          const historyCause = historyCauseForEvent(eventWithAt.type);
          for (const dateISO of changedDates) {
            const trace = buildDecisionTrace(nextState, dateISO);
            if (trace) {
              await upsertDecisionTrace(userId, dateISO, trace);
            }
            const dayContract = toDayContract(nextState, dateISO, domain);
            await insertDayPlanHistory({
              userId,
              dateISO,
              cause: historyCause,
              dayContract,
              traceRef: null,
            });
          }

          const todayISO = domain.isoToday();
          const analyticsUpdates = {};
          if (eventWithAt.type === "CHECKIN_SAVED") analyticsUpdates.checkins_count = 1;
          if (eventWithAt.type === "BAD_DAY_MODE") analyticsUpdates.bad_day_mode_count = 1;
          if (eventWithAt.type === "FEEDBACK_SUBMITTED" && eventWithAt.payload?.reason === "not_relevant") {
            analyticsUpdates.feedback_not_relevant_count = 1;
          }
          if (eventWithAt.type === "TOGGLE_PART_COMPLETION") {
            const dateISO = eventWithAt.payload?.dateISO;
            if (dateISO) {
              const prevParts = prevState.partCompletionByDate?.[dateISO] || {};
              const nextParts = nextState.partCompletionByDate?.[dateISO] || {};
              const prevAny = Boolean(prevParts.workout || prevParts.reset || prevParts.nutrition);
              const nextAny = Boolean(nextParts.workout || nextParts.reset || nextParts.nutrition);
              if (!prevAny && nextAny) analyticsUpdates.any_part_days_count = 1;
            }
          }
          if (Object.keys(analyticsUpdates).length) {
            const activeCount = await recordActiveUser(todayISO, userId);
            analyticsUpdates.active_users_count = activeCount;
            await updateAnalyticsDaily(todayISO, analyticsUpdates);
          } else if (resEvent.effects.persist) {
            const activeCount = await recordActiveUser(todayISO, userId);
            await updateAnalyticsDaily(todayISO, { active_users_count: activeCount });
          }

          state = nextState;
          version = saveRes.version;
          updateUserCache(userId, state, version);
          invalidateUserCache(userId);
          return { ...resEvent, state: nextState };
        }

        const latest = await loadUserState(userId);
        currentState = latest.state;
        currentVersion = latest.version;
        attempts += 1;
      }

      throw Object.assign(new Error("State conflict"), {
        status: 409,
        code: "state_conflict",
      });
    };

    if (pathname === "/v1/profile" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateProfile(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const userProfile = normalizeUserProfile(validation.value.userProfile);
      await dispatchForUser({ type: "BASELINE_SAVED", payload: { userProfile } });
      await dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
      send(200, { ok: true, userProfile: state.userProfile, weekPlan: state.weekPlan });
      return;
    }

    if (pathname === "/v1/onboard/complete" && req.method === "POST") {
      const body = await parseJson(req);
      const profileValidation = validateProfile({ userProfile: body?.userProfile });
      if (!profileValidation.ok) {
        sendError(res, 400, profileValidation.error.code, profileValidation.error.message, profileValidation.error.field);
        return;
      }
      const paramsState = await getParameters();
      const checkinValidation = validateCheckIn(
        { checkIn: body?.firstCheckIn },
        { allowedTimes: paramsState.map?.timeBuckets?.allowed }
      );
      if (!checkinValidation.ok) {
        sendError(res, 400, checkinValidation.error.code, checkinValidation.error.message, checkinValidation.error.field);
        return;
      }
      let targetUserId = userId;
      let targetEmail = userEmail;
      let issueTokens = false;
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!targetUserId && isAuthRequired()) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      if (!isAuthRequired() && email) {
        const user = await getOrCreateUser(email);
        targetUserId = user.id;
        targetEmail = user.email;
        issueTokens = true;
      }
      if (!targetUserId) {
        targetUserId = getUserId(req);
      }
      if (targetUserId !== userId) {
        userId = targetUserId;
        userEmail = targetEmail;
        res.livenewUserId = userId;
        const cached = await loadUserState(userId);
        state = cached.state;
        version = cached.version;
      }

      const userProfile = normalizeUserProfile(profileValidation.value.userProfile);
      const checkIn = checkinValidation.value.checkIn;
      await dispatchForUser({ type: "BASELINE_SAVED", payload: { userProfile } });
      await dispatchForUser({ type: "CHECKIN_SAVED", payload: { checkIn } });
      await dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
      const day = checkIn?.dateISO ? toDayContract(state, checkIn.dateISO, domain) : null;
      const payload = { ok: true, weekPlan: state.weekPlan, day };
      if (issueTokens) {
        const deviceName = getDeviceName(req);
        const refresh = await issueRefreshToken({ userId, deviceName });
        const accessToken = signAccessToken({
          userId,
          scope: "user",
          ttlSec: ACCESS_TOKEN_TTL_SEC,
          sessionId: refresh.refreshTokenId,
        });
        payload.accessToken = accessToken;
        payload.refreshToken = refresh.refreshToken;
        payload.expiresInSec = ACCESS_TOKEN_TTL_SEC;
        payload.token = accessToken;
      }
      send(200, payload);
      return;
    }

    if (pathname === "/v1/plan/week" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const date = url.searchParams.get("date");
      if (date) {
        const validation = validateDateParam(date, "date");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
      }
      await dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
      if (date) {
        await dispatchForUser({ type: "WEEK_REBUILD", payload: { weekAnchorISO: date } });
      }
      const payload = { ok: true, weekPlan: state.weekPlan };
      setCachedResponse(userId, pathname, url.search, payload);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/plan/day" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const dateISO = url.searchParams.get("date");
      if (!dateISO) {
        sendError(res, 400, "date_required", "date query param is required", "date");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      state = await ensureWeekForDate(state, dateISO, dispatchForUser);
      const day = toDayContract(state, dateISO, domain);
      const payload = { ok: true, day };
      setCachedResponse(userId, pathname, url.search, payload);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/plan/history/day" && req.method === "GET") {
      const dateISO = url.searchParams.get("date");
      if (!dateISO) {
        sendError(res, 400, "date_required", "date query param is required", "date");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const limitRaw = Number(url.searchParams.get("limit") || 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
      const history = await listDayPlanHistory(userId, dateISO, limit);
      send(200, { ok: true, dateISO, history });
      return;
    }

    if (pathname === "/v1/plan/compare" && req.method === "GET") {
      const dateISO = url.searchParams.get("date");
      const fromId = url.searchParams.get("fromId");
      const toId = url.searchParams.get("toId");
      if (!dateISO || !fromId || !toId) {
        sendError(res, 400, "params_required", "date, fromId, and toId are required");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const from = await getDayPlanHistoryById(fromId);
      const to = await getDayPlanHistoryById(toId);
      if (!from || !to || from.userId !== userId || to.userId !== userId) {
        sendError(res, 404, "history_not_found", "history item not found");
        return;
      }
      const diff = diffDayContracts(from.day, to.day);
      send(200, { ok: true, dateISO, from, to, diff });
      return;
    }

    if (pathname === "/v1/checkin" && req.method === "POST") {
      const body = await parseJson(req);
      const paramsState = await getParameters();
      const validation = validateCheckIn(body, { allowedTimes: paramsState.map?.timeBuckets?.allowed });
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const checkIn = validation.value.checkIn;
      const { result } = await dispatchForUser({ type: "CHECKIN_SAVED", payload: { checkIn } });
      const tomorrowISO = checkIn?.dateISO ? domain.addDaysISO(checkIn.dateISO, 1) : null;
      const day = checkIn?.dateISO ? toDayContract(state, checkIn.dateISO, domain) : null;
      const tomorrow = tomorrowISO ? toDayContract(state, tomorrowISO, domain) : null;
      send(200, {
        ok: true,
        changedDayISO: result?.changedDayISO || checkIn?.dateISO || null,
        notes: result?.notes || [],
        day,
        tomorrow: checkIn?.stress >= 7 && checkIn?.sleepQuality <= 5 ? tomorrow : null,
      });
      return;
    }

    if (pathname === "/v1/signal" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateSignal(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const { dateISO, signal } = validation.value;
      const nowMs = Date.now();
      const lastSignal = lastSignalByUser.get(userId);
      if (
        lastSignal &&
        lastSignal.dateISO === dateISO &&
        lastSignal.signal === signal &&
        nowMs - lastSignal.atMs < 500
      ) {
        const day = toDayContract(state, dateISO, domain);
        send(202, { ok: true, collapsed: true, changedDayISO: dateISO, day });
        return;
      }
      lastSignalByUser.set(userId, { atMs: nowMs, dateISO, signal });

      const { result } = await dispatchForUser({ type: "QUICK_SIGNAL", payload: { dateISO, signal } });
      const day = dateISO ? toDayContract(state, dateISO, domain) : null;
      send(200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        day,
      });
      return;
    }

    if (pathname === "/v1/bad-day" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateDateParam(body?.dateISO, "dateISO");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const dateISO = validation.value;
      const { result } = await dispatchForUser({ type: "BAD_DAY_MODE", payload: { dateISO } });
      const day = dateISO ? toDayContract(state, dateISO, domain) : null;
      send(200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        day,
      });
      return;
    }

    if (pathname === "/v1/feedback" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateFeedback(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const { dateISO, helped, reason } = validation.value;
      const { result } = await dispatchForUser({ type: "FEEDBACK_SUBMITTED", payload: { dateISO, helped, reason } });
      send(200, {
        ok: true,
        notes: result?.notes || [],
        modifiers: state.modifiers || {},
      });
      return;
    }

    if (pathname === "/v1/complete" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateComplete(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const { dateISO, part } = validation.value;
      await dispatchForUser({ type: "TOGGLE_PART_COMPLETION", payload: { dateISO, part } });
      const progress = domain.computeProgress({
        checkIns: state.checkIns || [],
        weekPlan: state.weekPlan,
        completions: state.partCompletionByDate || {},
      });
      send(200, {
        ok: true,
        completion: state.partCompletionByDate?.[dateISO] || {},
        progress,
      });
      return;
    }

    if (pathname === "/v1/progress" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const progress = domain.computeProgress({
        checkIns: state.checkIns || [],
        weekPlan: state.weekPlan,
        completions: state.partCompletionByDate || {},
      });
      const payload = { ok: true, progress };
      setCachedResponse(userId, pathname, url.search, payload);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/trends" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const daysParam = url.searchParams.get("days") || "7";
      const daysNum = Number(daysParam);
      const allowed = [7, 14, 30];
      if (!allowed.includes(daysNum)) {
        sendError(res, 400, "days_invalid", "days must be 7, 14, or 30", "days");
        return;
      }
      const trends = buildTrends(state, daysNum);
      const payload = { ok: true, days: trends };
      setCachedResponse(userId, pathname, url.search, payload);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/account/export" && req.method === "GET") {
      const events = await getUserEventsRecent(userId, 200);
      const traces = await listDecisionTracesRecent(userId, 30);
      const exportPayload = {
        userProfile: state.userProfile || null,
        checkIns: state.checkIns || [],
        completions: state.partCompletionByDate || {},
        feedback: state.feedback || [],
        events,
        decisionTraces: traces,
      };
      send(200, { ok: true, export: exportPayload });
      return;
    }

    if (pathname === "/v1/account/sessions" && req.method === "GET") {
      if (!token) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const sessions = await listRefreshTokensByUser(userId);
      const list = sessions.map((session) => ({
        token: session.id,
        deviceName: session.deviceName,
        createdAt: session.createdAt,
        lastSeenAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: authSessionId ? session.id === authSessionId : false,
        revokedAt: session.revokedAt,
      }));
      if (!list.length && usedLegacySession) {
        const legacy = await listSessionsByUser(userId);
        legacy.forEach((session) => {
          list.push({
            token: session.tokenHash,
            deviceName: session.deviceName,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            expiresAt: session.expiresAt,
            isCurrent: false,
          });
        });
      }
      send(200, { ok: true, sessions: list });
      return;
    }

    if (pathname === "/v1/account/sessions/revoke" && req.method === "POST") {
      if (!token) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const body = await parseJson(req);
      const revokeToken = body?.token;
      if (!revokeToken || typeof revokeToken !== "string") {
        sendError(res, 400, "token_required", "token is required", "token");
        return;
      }
      if (authSessionId && revokeToken === authSessionId) {
        sendError(res, 400, "cannot_revoke_current", "Use auth/refresh or logout to revoke current session");
        return;
      }
      const sessions = await listRefreshTokensByUser(userId);
      if (sessions.some((session) => session.id === revokeToken)) {
        await revokeRefreshTokenById(revokeToken);
      } else if (usedLegacySession) {
        await deleteSessionByTokenOrHash(revokeToken);
      } else {
        sendError(res, 404, "session_not_found", "session not found");
        return;
      }
      send(200, { ok: true });
      return;
    }

    if (pathname === "/v1/account/sessions/name" && req.method === "POST") {
      if (!token) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const body = await parseJson(req);
      const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim() : "";
      if (!deviceName) {
        sendError(res, 400, "device_name_required", "deviceName is required", "deviceName");
        return;
      }
      const trimmed = deviceName.slice(0, 64);
      if (authSessionId) {
        await updateRefreshTokenDeviceName(authSessionId, trimmed);
      } else if (usedLegacySession) {
        await touchSession(token, trimmed);
      }
      send(200, { ok: true, deviceName: trimmed });
      return;
    }

    if (pathname === "/v1/account" && req.method === "DELETE") {
      const confirmHeader = req.headers["x-confirm-delete"];
      if (confirmHeader !== "DELETE") {
        sendError(res, 400, "confirm_required", "x-confirm-delete must be DELETE", "x-confirm-delete");
        return;
      }
      let body = {};
      if (config.isAlphaLike) {
        body = await parseJson(req);
        if (body?.confirm !== "LiveNew") {
          sendError(res, 400, "confirm_required", "confirm must be LiveNew", "confirm");
          return;
        }
      }
      await deleteUserData(userId);
      userStates.delete(userId);
      send(200, { ok: true });
      return;
    }

    if (pathname === "/v1/admin/me" && req.method === "GET") {
      const email = await ensureUserEmail();
      if (!email) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const admin = isAdmin(email);
      send(200, { ok: true, isAdmin: admin, email });
      return;
    }

    if (pathname === "/v1/admin/flags" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const flags = await getFeatureFlags();
      send(200, { ok: true, flags });
      return;
    }

    if (pathname === "/v1/admin/flags" && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const key = body?.key;
      const value = body?.value;
      if (!key || typeof key !== "string") {
        sendError(res, 400, "key_required", "key is required", "key");
        return;
      }
      if (value == null) {
        sendError(res, 400, "value_required", "value is required", "value");
        return;
      }
      const updated = await setFeatureFlag(key, value);
      featureFlagsCache.data = null;
      send(200, { ok: true, flag: updated });
      return;
    }

    if (pathname === "/v1/admin/parameters" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const paramsState = await getParameters();
      send(200, {
        ok: true,
        parameters: paramsState.map,
        versions: paramsState.versions,
        errors: paramsState.errors,
      });
      return;
    }

    if (pathname === "/v1/admin/parameters" && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const key = body?.key;
      if (!key || typeof key !== "string") {
        sendError(res, 400, "key_required", "key is required", "key");
        return;
      }
      const defaults = getDefaultParameters();
      if (!(key in defaults)) {
        sendError(res, 400, "key_invalid", "Unknown parameter key", "key");
        return;
      }
      let value = body?.value;
      if (value == null && typeof body?.value_json === "string") {
        try {
          value = JSON.parse(body.value_json);
        } catch {
          sendError(res, 400, "value_invalid", "value_json must be valid JSON", "value_json");
          return;
        }
      }
      if (value == null) {
        sendError(res, 400, "value_required", "value is required", "value");
        return;
      }
      const updated = await upsertParameter(key, value);
      resetParametersCache();
      send(200, { ok: true, key, version: updated.version, updatedAt: updated.updatedAt });
      return;
    }

    if (pathname === "/v1/admin/metrics/latency" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const entries = Array.from(LATENCY_ROUTES).map((routeKey) => ({
        route: routeKey,
        ...latencyStats(routeKey),
      }));
      send(200, { ok: true, metrics: entries });
      return;
    }

    if (pathname === "/v1/admin/trace" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      const dateISO = url.searchParams.get("date");
      if (!userIdParam || !dateISO) {
        sendError(res, 400, "params_required", "userId and date are required");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const trace = await getDecisionTrace(userIdParam, dateISO);
      send(200, { ok: true, trace });
      return;
    }

    if (pathname === "/v1/admin/traces" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      const fromISO = url.searchParams.get("from");
      const toISO = url.searchParams.get("to");
      if (!userIdParam || !fromISO || !toISO) {
        sendError(res, 400, "params_required", "userId, from, and to are required");
        return;
      }
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const traces = await listDecisionTraces(userIdParam, fromISO, toISO, page, pageSize);
      send(200, { ok: true, traces, page, pageSize });
      return;
    }

    if (pathname === "/v1/admin/events" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      if (!userIdParam) {
        sendError(res, 400, "userId_required", "userId is required", "userId");
        return;
      }
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const events = await listUserEventsPaged(userIdParam, page, pageSize);
      send(200, { ok: true, events, page, pageSize });
      return;
    }

    const contentDisableMatch = pathname.match(/^\/v1\/admin\/content\/(workout|nutrition|reset)\/([^/]+)\/disable$/);
    if (contentDisableMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = contentDisableMatch[1];
      const id = contentDisableMatch[2];
      const updated = await patchContentItem(kind, id, { enabled: false });
      if (!updated) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      await applyLibraryFromDb();
      send(200, { ok: true, item: updated });
      return;
    }

    const contentPatchMatch = pathname.match(/^\/v1\/admin\/content\/(workout|nutrition|reset)\/([^/]+)$/);
    if (contentPatchMatch && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = contentPatchMatch[1];
      const id = contentPatchMatch[2];
      const body = await parseJson(req);
      const allowed = ["enabled", "priority", "noveltyGroup", "tags", "minutes", "steps", "priorities", "title"];
      const patch = {};
      allowed.forEach((key) => {
        if (key in body) patch[key] = body[key];
      });
      if ("enabled" in patch && typeof patch.enabled !== "boolean") {
        sendError(res, 400, "field_invalid", "enabled must be boolean", "enabled");
        return;
      }
      if ("priority" in patch && !Number.isFinite(Number(patch.priority))) {
        sendError(res, 400, "field_invalid", "priority must be number", "priority");
        return;
      }
      if ("noveltyGroup" in patch && patch.noveltyGroup != null && typeof patch.noveltyGroup !== "string") {
        sendError(res, 400, "field_invalid", "noveltyGroup must be string", "noveltyGroup");
        return;
      }
      if ("tags" in patch && !Array.isArray(patch.tags)) {
        sendError(res, 400, "field_invalid", "tags must be array", "tags");
        return;
      }
      if ("steps" in patch && !Array.isArray(patch.steps)) {
        sendError(res, 400, "field_invalid", "steps must be array", "steps");
        return;
      }
      if ("priorities" in patch && !Array.isArray(patch.priorities)) {
        sendError(res, 400, "field_invalid", "priorities must be array", "priorities");
        return;
      }
      if ("minutes" in patch && !Number.isFinite(Number(patch.minutes))) {
        sendError(res, 400, "field_invalid", "minutes must be number", "minutes");
        return;
      }
      const updated = await patchContentItem(kind, id, patch);
      if (!updated) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      await applyLibraryFromDb();
      send(200, { ok: true, item: updated });
      return;
    }

    if (pathname === "/v1/admin/content" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = url.searchParams.get("kind");
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const items = await listContentItemsPaged(kind || undefined, page, pageSize);
      send(200, { ok: true, items, page, pageSize });
      return;
    }

    if (pathname === "/v1/admin/content" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const kind = body?.kind;
      const item = body?.item;
      if (!["workout", "nutrition", "reset"].includes(kind)) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      if (!item || typeof item !== "object") {
        sendError(res, 400, "item_invalid", "item is required", "item");
        return;
      }
      const saved = await upsertContentItem(kind, item);
      await applyLibraryFromDb();
      send(200, { ok: true, item: saved });
      return;
    }

    if (pathname === "/v1/admin/content/bulk" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const items = body?.items;
      if (!Array.isArray(items) || !items.length) {
        sendError(res, 400, "items_invalid", "items must be a non-empty array", "items");
        return;
      }
      const saved = [];
      for (const entry of items) {
        const kind = entry?.kind;
        const item = entry?.item;
        if (!["workout", "nutrition", "reset"].includes(kind) || !item) continue;
        const record = await upsertContentItem(kind, item);
        saved.push(record);
      }
      await applyLibraryFromDb();
      send(200, { ok: true, items: saved });
      return;
    }

    if (pathname === "/v1/admin/stats/content" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = url.searchParams.get("kind");
      if (!["workout", "nutrition", "reset"].includes(kind)) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      const fromISO = url.searchParams.get("from");
      const toISO = url.searchParams.get("to");
      if (fromISO) {
        const validation = validateDateParam(fromISO, "from");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
      }
      if (toISO) {
        const validation = validateDateParam(toISO, "to");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
      }
      const statsRows = await getAdminStats();
      const statsMap = new Map();
      statsRows.forEach((row) => {
        statsMap.set(row.itemId, row);
      });
      const items = await listContentItems(kind, true);
      const enriched = items.map((item) => {
        const stat = statsMap.get(item.id) || { picked: 0, completed: 0, notRelevant: 0 };
        const picked = stat.picked || 0;
        const completionRate = picked ? stat.completed / picked : 0;
        const notRelevantRate = picked ? stat.notRelevant / picked : 0;
        return {
          item,
          stats: {
            picked,
            completed: stat.completed || 0,
            notRelevant: stat.notRelevant || 0,
            completionRate,
            notRelevantRate,
          },
        };
      });
      send(200, { ok: true, kind, fromISO, toISO, items: enriched });
      return;
    }

    if (pathname === "/v1/admin/stats" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      if (userIdParam) {
        const sanitized = sanitizeUserId(userIdParam);
        if (sanitized !== userIdParam) {
          sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
          return;
        }
        const stats = await getContentStats(userIdParam);
        send(200, { ok: true, userId: userIdParam, stats });
        return;
      }
      const stats = await getAdminStats();
      send(200, { ok: true, stats });
      return;
    }

    if (pathname === "/v1/admin/analytics/daily" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      let fromISO = url.searchParams.get("from");
      let toISO = url.searchParams.get("to");
      if (!fromISO || !toISO) {
        const range = defaultDateRange(14);
        fromISO = fromISO || range.fromISO;
        toISO = toISO || range.toISO;
      }
      const fromValidation = validateDateParam(fromISO, "from");
      if (!fromValidation.ok) {
        sendError(res, 400, fromValidation.error.code, fromValidation.error.message, fromValidation.error.field);
        return;
      }
      const toValidation = validateDateParam(toISO, "to");
      if (!toValidation.ok) {
        sendError(res, 400, toValidation.error.code, toValidation.error.message, toValidation.error.field);
        return;
      }
      const days = await listAnalyticsDaily(fromISO, toISO);
      send(200, { ok: true, fromISO, toISO, days });
      return;
    }

    if (pathname === "/v1/admin/reports/worst-items" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = url.searchParams.get("kind");
      if (!["workout", "nutrition", "reset"].includes(kind)) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      const limitRaw = Number(url.searchParams.get("limit") || 20);
      const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 100) : 20;
      const items = await getWorstItems(kind, limit);
      send(200, { ok: true, kind, limit, items });
      return;
    }

    if (pathname === "/v1/admin/db/backup" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const backup = await createBackup();
      send(200, { ok: true, backup });
      return;
    }

    if (pathname === "/v1/admin/db/restore" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const backupId = body?.backupId;
      if (!backupId || typeof backupId !== "string") {
        sendError(res, 400, "backupId_required", "backupId is required", "backupId");
        return;
      }
      const backups = await listBackups();
      if (!backups.includes(backupId)) {
        sendError(res, 404, "backup_not_found", "backupId not found", "backupId");
        return;
      }
      const restored = await restoreBackup(backupId);
      send(200, { ok: true, backupId: restored.backupId });
      return;
    }

    if (pathname === "/v1/admin/tasks/run" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const task = body?.task;
      if (!["backup", "cleanup"].includes(task)) {
        sendError(res, 400, "task_invalid", "task must be backup or cleanup", "task");
        return;
      }
      const result = await taskScheduler.runTask(task);
      send(200, { ok: true, task, result });
      return;
    }

    if (pathname === "/v1/admin/repair" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      if (!userIdParam) {
        sendError(res, 400, "userId_required", "userId is required", "userId");
        return;
      }
      const sanitized = sanitizeUserId(userIdParam);
      if (sanitized !== userIdParam) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const repaired = await repairUserState(userIdParam, "manual_admin");
      if (!repaired.ok) {
        sendError(res, 500, "repair_failed", "Unable to repair user state");
        return;
      }
      send(200, { ok: true, repaired: true, userId: userIdParam });
      return;
    }

    if (isDevRoutesEnabled) {
      if (pathname === "/v1/dev/replay" && req.method === "POST") {
        const body = await parseJson(req);
        const validation = validateReplay(body);
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
        const replayUserId = sanitizeUserId(validation.value.userId || userId);
        res.livenewUserId = replayUserId;

        let replayState = normalizeState(validation.value.initialState || {});
        const now = { todayISO: domain.isoToday(), atISO: new Date().toISOString() };
        const flags = await getFeatureFlags();
        const paramsState = await getParameters();

        for (const evt of validation.value.events) {
          const atISO = evt.atISO || now.atISO;
          const ctx = {
            domain,
            now: { todayISO: now.todayISO, atISO },
            ruleToggles: resolveRuleToggles(replayState, flags),
            scenarios: { getScenarioById },
            isDev: true,
            params: paramsState.map,
          };
          const result = reduceEvent(replayState, { type: evt.type, payload: evt.payload, atISO }, ctx);
          replayState = appendLogEvent(result.nextState, result.logEvent);
        }

        const day = toDayContract(replayState, now.todayISO, domain);
        const progress = domain.computeProgress({
          checkIns: replayState.checkIns || [],
          weekPlan: replayState.weekPlan,
          completions: replayState.partCompletionByDate || {},
        });
        const finalStateSummary = {
          hasProfile: Boolean(replayState.userProfile),
          weekStartDateISO: replayState.weekPlan?.startDateISO || null,
          checkInsCount: replayState.checkIns?.length || 0,
          feedbackCount: replayState.feedback?.length || 0,
          modifiers: replayState.modifiers || {},
          ruleToggles: replayState.ruleToggles || {},
        };
        sendJson(res, 200, { ok: true, finalStateSummary, day, progress }, replayUserId);
        return;
      }

      if (pathname === "/v1/dev/trace" && req.method === "GET") {
        const dateISO = url.searchParams.get("date");
        if (!dateISO) {
          sendError(res, 400, "date_required", "date query param is required", "date");
          return;
        }
        const validation = validateDateParam(dateISO, "date");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
        const trace = await getDecisionTrace(userId, dateISO);
        send(200, { ok: true, trace });
        return;
      }

      if (pathname === "/v1/dev/events" && req.method === "GET") {
        const userIdParam = url.searchParams.get("userId");
        const targetUserId = userIdParam ? sanitizeUserId(userIdParam) : userId;
        const page = Number(url.searchParams.get("page") || 0);
        const pageSize = Number(url.searchParams.get("pageSize") || 0);
        let events = [];
        if (page || pageSize) {
          events = await listUserEventsPaged(targetUserId, page || 1, pageSize || 50);
        } else {
          const fromSeq = Number(url.searchParams.get("fromSeq") || 1);
          const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
          events = await getUserEvents(targetUserId, fromSeq, limit);
        }
        send(200, { ok: true, events, userId: targetUserId });
        return;
      }

      if (pathname === "/v1/dev/rewind" && req.method === "POST") {
        const body = await parseJson(req);
        const targetUserId = sanitizeUserId(body?.userId || userId);
        const seq = Number(body?.seq);
        if (!Number.isInteger(seq) || seq < 0) {
          sendError(res, 400, "seq_invalid", "seq must be a non-negative integer", "seq");
          return;
        }
        const events = seq === 0 ? [] : await getUserEvents(targetUserId, 1, seq);
        let rebuilt = normalizeState({});
        const flags = await getFeatureFlags();
        const paramsState = await getParameters();
        for (const evt of events) {
          const ctx = {
            domain,
            now: { todayISO: domain.isoToday(), atISO: evt.atISO },
            ruleToggles: resolveRuleToggles(rebuilt, flags),
            scenarios: { getScenarioById },
            isDev: true,
            params: paramsState.map,
          };
          const result = reduceEvent(rebuilt, { type: evt.type, payload: evt.payload, atISO: evt.atISO }, ctx);
          rebuilt = appendLogEvent(result.nextState, result.logEvent);
        }
        const latest = await loadUserState(targetUserId);
        const saveRes = await saveUserState(targetUserId, latest.version, rebuilt);
        if (!saveRes.ok) {
          sendError(res, 409, "state_conflict", "State conflict during rewind");
          return;
        }
        updateUserCache(targetUserId, rebuilt, saveRes.version);
        sendJson(res, 200, { ok: true, userId: targetUserId, version: saveRes.version }, targetUserId);
        return;
      }

      if (pathname === "/v1/dev/repair" && req.method === "POST") {
        const repaired = await repairUserState(userId, "manual_dev");
        if (!repaired.ok) {
          sendError(res, 500, "repair_failed", "Unable to repair user state");
          return;
        }
        send(200, { ok: true, repaired: true });
        return;
      }

      if (pathname === "/v1/dev/content" && req.method === "GET") {
        const items = await listContentItems();
        if (items.length) {
          const workouts = items.filter((item) => item.kind === "workout");
          const nutrition = items.filter((item) => item.kind === "nutrition");
          const resets = items.filter((item) => item.kind === "reset");
          send(200, {
            ok: true,
            library: {
              workouts: summarizeLibraryItems(workouts),
              nutrition: summarizeLibraryItems(nutrition),
              resets: summarizeLibraryItems(resets),
            },
          });
          return;
        }
        const library = domain.defaultLibrary || {};
        send(200, {
          ok: true,
          library: {
            workouts: summarizeLibraryItems(library.workouts),
            nutrition: summarizeLibraryItems(library.nutrition),
            resets: summarizeLibraryItems(library.resets),
          },
        });
        return;
      }

      if (pathname === "/v1/dev/stats" && req.method === "GET") {
        const dbStats = await getContentStats(userId);
        send(200, { ok: true, selectionStats: state.selectionStats || {}, contentStats: dbStats });
        return;
      }

      if (pathname === "/v1/dev/bundle" && req.method === "GET") {
        const lastCheckIns = (state.checkIns || []).slice(0, 14);
        const stressKeys = Object.keys(state.lastStressStateByDate || {}).sort().slice(-7);
        const stressSubset = {};
        stressKeys.forEach((key) => {
          stressSubset[key] = state.lastStressStateByDate[key];
        });
        const flags = await getFeatureFlags();
        send(200, {
          ok: true,
          bundle: {
            versions: {
              pipelineVersion: state.weekPlan?.days?.[0]?.pipelineVersion ?? domain.DECISION_PIPELINE_VERSION ?? null,
              schemaVersion: state.schemaVersion ?? null,
            },
            userProfile: state.userProfile,
            weekPlan: state.weekPlan,
            checkIns: lastCheckIns,
            lastStressStateByDate: stressSubset,
            modifiers: state.modifiers,
            ruleToggles: state.ruleToggles,
            featureFlags: flags,
            eventLog: (state.eventLog || []).slice(0, 30),
          },
        });
        return;
      }

      if (pathname === "/v1/dev/rules" && req.method === "POST") {
        const body = await parseJson(req);
        const validation = validateRules(body);
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
        const { ruleToggles } = validation.value;
        const { result } = await dispatchForUser({ type: "SET_RULE_TOGGLES", payload: { ruleToggles } });
        send(200, { ok: true, ruleToggles: result?.ruleToggles || state.ruleToggles });
        return;
      }

      if (pathname === "/v1/dev/scenario" && req.method === "POST") {
        const body = await parseJson(req);
        const scenarioId = body.scenarioId;
        await dispatchForUser({ type: "APPLY_SCENARIO", payload: { scenarioId } });
        const todayISO = domain.isoToday();
        const day = toDayContract(state, todayISO, domain);
        send(200, { ok: true, scenarioId, day });
        return;
      }

      if (pathname === "/v1/dev/snapshot/run" && req.method === "POST") {
        const body = await parseJson(req);
        const scenarioId = body.scenarioId;
        const allowParamDrift = body?.allowParamDrift === true;
        const ids = scenarioId ? [scenarioId] : SNAPSHOT_IDS;
        const results = [];
        const flags = await getFeatureFlags();
        const paramsState = await getParameters();
        for (const id of ids) {
          const resCheck = await runSnapshotCheck(id, state, {
            now: { todayISO: domain.isoToday(), atISO: new Date().toISOString() },
            ruleToggles: resolveRuleToggles(state, flags),
            paramsVersion: paramsState.versions,
            params: paramsState.map,
            allowParamDrift,
          });
          results.push({ scenarioId: id, ok: resCheck.ok, diffsCount: resCheck.diffs.length });
        }
        send(200, { ok: true, results });
        return;
      }
    }

    sendError(res, 404, "not_found", "Not found");
  } catch (err) {
    const status = err?.status || 500;
    if (err?.code) {
      sendError(res, status, err.code, err.message || "Request error", err.field);
      if (NODE_ENV !== "production") {
        console.error(
          JSON.stringify({
            atISO: new Date().toISOString(),
            errorCode: err.code,
            stack: err.stack,
          })
        );
      }
      return;
    }
    if (NODE_ENV !== "production") {
      console.error(
        JSON.stringify({
          atISO: new Date().toISOString(),
          errorCode: "server_error",
          stack: err?.stack,
        })
      );
    }
    sendError(res, status, "server_error", err?.message || "Server error");
  }
});

server.listen(PORT, () => {
  console.log(`LiveNew server listening on http://localhost:${PORT}`);
});

server.requestTimeout = 15000;
server.timeout = 15000;

async function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`LiveNew shutting down (${signal})...`);
  taskScheduler.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
