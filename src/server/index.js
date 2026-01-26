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
  getOrCreateUser,
  createAuthCode,
  verifyAuthCode,
  createSession,
  getSession,
  seedContentItems,
  listContentItems,
  upsertContentItem,
  bumpContentStats,
  getContentStats,
  getAdminStats,
} from "../state/db.js";

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const ALPHA_MODE = process.env.ALPHA_MODE === "true";
const isDevEnabled = NODE_ENV !== "production" && !ALPHA_MODE;
const EVENT_SOURCING = process.env.EVENT_SOURCING === "true";
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);

const PUBLIC_DIR = path.join(process.cwd(), "public");

const userStates = new Map();
const MAX_USERS = 50;
const lastSignalByUser = new Map();
const rateLimiters = new Map();
let shuttingDown = false;

await ensureDataDirWritable();
await initDb();
await seedContentItems(domain.defaultLibrary);
await applyLibraryFromDb();

async function ensureDataDirWritable() {
  const dir = path.dirname(getDbPath());
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

async function applyLibraryFromDb() {
  const items = await listContentItems();
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
  validateState(state);
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
  };
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
    ruleToggles: state.ruleToggles,
    now: { todayISO: domain.isoToday(), atISO: new Date().toISOString() },
    scenarios: { getScenarioById },
    isDev: isDevEnabled,
    ...ctxOverrides,
  };

  const { nextState, effects, logEvent, result } = reduceEvent(state, event, ctx);
  const next = appendLogEvent(nextState, logEvent);
  return { state: next, result, logEvent, effects };
}

function sendJson(res, status, payload, userId) {
  const body = userId ? { userId, ...payload } : { ...payload };
  if (res?.livenewRequestId) body.requestId = res.livenewRequestId;
  res.writeHead(status, { "Content-Type": "application/json" });
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
  return "application/octet-stream";
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

function isAuthRequired() {
  return ALPHA_MODE || NODE_ENV === "production";
}

function parseAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

function isAdmin(email) {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}

function getLimiter(userId) {
  if (!rateLimiters.has(userId)) {
    rateLimiters.set(userId, {
      general: { tokens: 60, last: Date.now() },
      mutating: { tokens: 10, last: Date.now() },
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
  const okGeneral = takeToken(limiter.general, 60, 60 / 60000);
  if (!okGeneral) return { ok: false, kind: "general" };
  if (isMutating) {
    const okMutating = takeToken(limiter.mutating, 10, 10 / 60000);
    if (!okMutating) return { ok: false, kind: "mutating" };
  }
  return { ok: true };
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

async function serveFile(res, filePath, { replaceDevFlag } = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const body = replaceDevFlag ? raw.replace("__IS_DEV__", isDevEnabled ? "true" : "false") : raw;
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

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const logEntry = {
      atISO: new Date().toISOString(),
      requestId,
      userId: res.livenewUserId || null,
      route: pathname,
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

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    await serveFile(res, path.join(PUBLIC_DIR, "index.html"), { replaceDevFlag: true });
    return;
  }

  if (req.method === "GET" && pathname === "/app.js") {
    await serveFile(res, path.join(PUBLIC_DIR, "app.js"));
    return;
  }

  if (req.method === "GET" && pathname === "/styles.css") {
    await serveFile(res, path.join(PUBLIC_DIR, "styles.css"));
    return;
  }

  try {
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
      await checkDbConnection();
      await checkReady();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/v1/auth/request" && req.method === "POST") {
      const body = await parseJson(req);
      const email = body?.email;
      if (!email || typeof email !== "string") {
        sendError(res, 400, "email_required", "email is required", "email");
        return;
      }
      const user = await getOrCreateUser(email.toLowerCase());
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await createAuthCode(user.id, user.email, code, expiresAt);
      res.livenewUserId = user.id;
      if (isDevEnabled) {
        sendJson(res, 200, { ok: true, code }, user.id);
      } else {
        console.log(`LiveNew auth code for ${email}: ${code}`);
        sendJson(res, 200, { ok: true }, user.id);
      }
      return;
    }

    if (pathname === "/v1/auth/verify" && req.method === "POST") {
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
      const verified = await verifyAuthCode(email.toLowerCase(), code);
      if (!verified) {
        sendError(res, 401, "code_invalid", "code is invalid or expired", "code");
        return;
      }
      const token = await createSession(verified.userId);
      res.livenewUserId = verified.userId;
      sendJson(res, 200, { ok: true, token }, verified.userId);
      return;
    }

    let userId = null;
    let userEmail = null;
    const token = parseAuthToken(req);
    if (token) {
      const session = await getSession(token);
      if (session) {
        userId = session.user_id;
        userEmail = session.email;
      }
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
        const resEvent = dispatch(currentState, eventWithAt);
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
          state = nextState;
          version = saveRes.version;
          updateUserCache(userId, state, version);
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

    if (pathname === "/v1/plan/week" && req.method === "GET") {
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
      send(200, { ok: true, weekPlan: state.weekPlan });
      return;
    }

    if (pathname === "/v1/plan/day" && req.method === "GET") {
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
      send(200, { ok: true, day });
      return;
    }

    if (pathname === "/v1/checkin" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateCheckIn(body);
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
      const progress = domain.computeProgress({
        checkIns: state.checkIns || [],
        weekPlan: state.weekPlan,
        completions: state.partCompletionByDate || {},
      });
      send(200, { ok: true, progress });
      return;
    }

    if (pathname === "/v1/trends" && req.method === "GET") {
      const daysParam = url.searchParams.get("days") || "7";
      const daysNum = Number(daysParam);
      const allowed = [7, 14, 30];
      if (!allowed.includes(daysNum)) {
        sendError(res, 400, "days_invalid", "days must be 7, 14, or 30", "days");
        return;
      }
      const trends = buildTrends(state, daysNum);
      send(200, { ok: true, days: trends });
      return;
    }

    if (pathname === "/v1/admin/content" && req.method === "GET") {
      if (!userEmail) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      if (!isAdmin(userEmail)) {
        sendError(res, 403, "forbidden", "Admin access required");
        return;
      }
      const kind = url.searchParams.get("kind");
      const items = await listContentItems(kind || undefined);
      send(200, { ok: true, items });
      return;
    }

    if (pathname === "/v1/admin/content" && req.method === "POST") {
      if (!userEmail) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      if (!isAdmin(userEmail)) {
        sendError(res, 403, "forbidden", "Admin access required");
        return;
      }
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
      if (!userEmail) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      if (!isAdmin(userEmail)) {
        sendError(res, 403, "forbidden", "Admin access required");
        return;
      }
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

    if (pathname === "/v1/admin/stats" && req.method === "GET") {
      if (!userEmail) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      if (!isAdmin(userEmail)) {
        sendError(res, 403, "forbidden", "Admin access required");
        return;
      }
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

    if (pathname === "/v1/dev/replay" && req.method === "POST") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
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

      for (const evt of validation.value.events) {
        const atISO = evt.atISO || now.atISO;
        const ctx = {
          domain,
          now: { todayISO: now.todayISO, atISO },
          ruleToggles: replayState.ruleToggles,
          scenarios: { getScenarioById },
          isDev: true,
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

    if (pathname === "/v1/dev/events" && req.method === "GET") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      const userIdParam = url.searchParams.get("userId");
      const targetUserId = userIdParam ? sanitizeUserId(userIdParam) : userId;
      const fromSeq = Number(url.searchParams.get("fromSeq") || 1);
      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
      const events = await getUserEvents(targetUserId, fromSeq, limit);
      send(200, { ok: true, events, userId: targetUserId });
      return;
    }

    if (pathname === "/v1/dev/rewind" && req.method === "POST") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      const body = await parseJson(req);
      const targetUserId = sanitizeUserId(body?.userId || userId);
      const seq = Number(body?.seq);
      if (!Number.isInteger(seq) || seq < 0) {
        sendError(res, 400, "seq_invalid", "seq must be a non-negative integer", "seq");
        return;
      }
      const events = seq === 0 ? [] : await getUserEvents(targetUserId, 1, seq);
      let rebuilt = normalizeState({});
      for (const evt of events) {
        const ctx = {
          domain,
          now: { todayISO: domain.isoToday(), atISO: evt.atISO },
          ruleToggles: rebuilt.ruleToggles,
          scenarios: { getScenarioById },
          isDev: true,
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

    if (pathname === "/v1/dev/content" && req.method === "GET") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
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
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      const dbStats = await getContentStats(userId);
      send(200, { ok: true, selectionStats: state.selectionStats || {}, contentStats: dbStats });
      return;
    }

    if (pathname === "/v1/dev/bundle" && req.method === "GET") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      const lastCheckIns = (state.checkIns || []).slice(0, 14);
      const stressKeys = Object.keys(state.lastStressStateByDate || {}).sort().slice(-7);
      const stressSubset = {};
      stressKeys.forEach((key) => {
        stressSubset[key] = state.lastStressStateByDate[key];
      });
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
          eventLog: (state.eventLog || []).slice(0, 30),
        },
      });
      return;
    }

    if (pathname === "/v1/dev/rules" && req.method === "POST") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
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
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      const body = await parseJson(req);
      const scenarioId = body.scenarioId;
      await dispatchForUser({ type: "APPLY_SCENARIO", payload: { scenarioId } });
      const todayISO = domain.isoToday();
      const day = toDayContract(state, todayISO, domain);
      send(200, { ok: true, scenarioId, day });
      return;
    }

    if (pathname === "/v1/dev/snapshot/run" && req.method === "POST") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      const body = await parseJson(req);
      const scenarioId = body.scenarioId;
      const ids = scenarioId ? [scenarioId] : SNAPSHOT_IDS;
      const results = [];
      for (const id of ids) {
        const resCheck = await runSnapshotCheck(id, state, {
          now: { todayISO: domain.isoToday(), atISO: new Date().toISOString() },
          ruleToggles: state.ruleToggles,
        });
        results.push({ scenarioId: id, ok: resCheck.ok, diffsCount: resCheck.diffs.length });
      }
      send(200, { ok: true, results });
      return;
    }

    sendError(res, 404, "not_found", "Not found");
  } catch (err) {
    const status = err?.status || 500;
    if (err?.code) {
      sendError(res, status, err.code, err.message || "Request error", err.field);
      return;
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
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
