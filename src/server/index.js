import http from "http";
import fs from "fs/promises";
import path from "path";
import * as domain from "../domain/index.js";
import { loadState, enqueueSave, flushAll, getStatePath } from "../state/storage.js";
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

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isDevEnabled = NODE_ENV !== "production" && process.env.ALPHA_MODE !== "true";

const PUBLIC_DIR = path.join(process.cwd(), "public");

const userStates = new Map();
const MAX_USERS = 50;
const lastSignalByUser = new Map();

await ensureDataDirWritable();

async function ensureDataDirWritable() {
  const dir = path.dirname(getStatePath("default"));
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
    return cached.state;
  }
  const state = normalizeState(await loadState(userId));
  validateState(state);
  userStates.set(userId, { state, lastAccessAt: Date.now() });
  evictIfNeeded();
  return state;
}

function updateUserCache(userId, state) {
  userStates.set(userId, { state, lastAccessAt: Date.now() });
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

function dispatch(userId, state, event, options = {}) {
  const ctx = {
    domain,
    ruleToggles: state.ruleToggles,
    now: { todayISO: domain.isoToday(), atISO: new Date().toISOString() },
    scenarios: { getScenarioById },
    isDev: isDevEnabled,
  };

  const { nextState, effects, logEvent, result } = reduceEvent(state, event, ctx);
  const next = appendLogEvent(nextState, logEvent);
  if ((effects.persist || logEvent) && !options.skipPersist) enqueueSave(userId, next);
  return { state: next, result, logEvent, effects };
}

function sendJson(res, status, payload, userId) {
  const body = userId ? { userId, ...payload } : payload;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function parseJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
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

function ensureWeekForDate(state, dateISO, dispatchFn) {
  if (!state.userProfile) return state;
  if (!state.weekPlan) {
    const res = dispatchFn({ type: "ENSURE_WEEK", payload: {} });
    state = res.state;
    if (!state.weekPlan || !dateISO) return state;
  }
  if (dateISO && !state.weekPlan.days.some((d) => d.dateISO === dateISO)) {
    const res = dispatchFn({ type: "WEEK_REBUILD", payload: { weekAnchorISO: dateISO } });
    return res.state;
  }
  return dispatchFn({ type: "ENSURE_WEEK", payload: {} }).state;
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

  const userId = getUserId(req);
  const send = (status, payload) => sendJson(res, status, payload, userId);
  res.livenewUserId = userId;

  try {
    if (pathname === "/healthz" && req.method === "GET") {
      send(200, {
        ok: true,
        versions: {
          pipelineVersion: domain.DECISION_PIPELINE_VERSION ?? null,
          schemaVersion: domain.STATE_SCHEMA_VERSION ?? null,
        },
        uptimeSec: Math.round(process.uptime()),
      });
      return;
    }

    let state = await loadUserState(userId);
    const dispatchForUser = (event, options) => {
      const res = dispatch(userId, state, event, options);
      state = res.state;
      updateUserCache(userId, state);
      return res;
    };

    if (pathname === "/v1/profile" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateProfile(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const userProfile = normalizeUserProfile(validation.value.userProfile);
      dispatchForUser({ type: "BASELINE_SAVED", payload: { userProfile } });
      dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
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
      dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
      if (date) {
        dispatchForUser({ type: "WEEK_REBUILD", payload: { weekAnchorISO: date } });
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
      state = ensureWeekForDate(state, dateISO, dispatchForUser);
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
      const { result } = dispatchForUser({ type: "CHECKIN_SAVED", payload: { checkIn } });
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

      const { result } = dispatchForUser({ type: "QUICK_SIGNAL", payload: { dateISO, signal } });
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
      const { result } = dispatchForUser({ type: "BAD_DAY_MODE", payload: { dateISO } });
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
      const { result } = dispatchForUser({ type: "FEEDBACK_SUBMITTED", payload: { dateISO, helped, reason } });
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
      dispatchForUser({ type: "TOGGLE_PART_COMPLETION", payload: { dateISO, part } });
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

    if (pathname === "/v1/dev/content" && req.method === "GET") {
      if (!isDevEnabled) {
        sendError(res, 404, "not_found", "Not found");
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
      send(200, { ok: true, selectionStats: state.selectionStats || {} });
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
      const { result } = dispatchForUser({ type: "SET_RULE_TOGGLES", payload: { ruleToggles } });
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
      dispatchForUser({ type: "APPLY_SCENARIO", payload: { scenarioId } });
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

let shuttingDown = false;
async function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`LiveNew shutting down (${signal})...`);
  try {
    await flushAll();
  } catch (err) {
    console.error("Failed to flush state during shutdown", err);
  }
  process.exit(0);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
