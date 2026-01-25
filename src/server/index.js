import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as domain from "../domain/index.js";
import { loadState, enqueueSave } from "../state/storage.js";
import { reduceEvent } from "../state/engine.js";
import { validateState } from "../domain/schema.js";
import { getScenarioById } from "../dev/scenarios.js";
import { runSnapshotCheck, SNAPSHOT_IDS } from "../dev/snapshot.js";

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV !== "production";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

let state = await loadState();
validateState(state);

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

function dispatch(event) {
  const ctx = {
    domain,
    ruleToggles: state.ruleToggles,
    now: { todayISO: domain.isoToday(), atISO: new Date().toISOString() },
    scenarios: { getScenarioById },
    isDev,
  };

  const { nextState, effects, logEvent, result } = reduceEvent(state, event, ctx);
  state = appendLogEvent(nextState, logEvent);
  if (effects.persist || logEvent) enqueueSave(state);
  return { state, result };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function parseJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("bad_json");
    err.status = 400;
    throw err;
  }
}

function findDayPlan(dateISO) {
  return state.weekPlan?.days?.find((d) => d.dateISO === dateISO) || null;
}

function ensureWeekForDate(dateISO) {
  if (!state.userProfile) return;
  if (!state.weekPlan) {
    dispatch({ type: "ENSURE_WEEK", payload: {} });
    if (!state.weekPlan || !dateISO) return;
  }
  if (dateISO && !state.weekPlan.days.some((d) => d.dateISO === dateISO)) {
    dispatch({ type: "WEEK_REBUILD", payload: { weekAnchorISO: dateISO } });
    return;
  }
  dispatch({ type: "ENSURE_WEEK", payload: {} });
}

function computeAnyPartCompletionRate(weekPlan, partCompletionByDate) {
  if (!weekPlan || !Array.isArray(weekPlan.days)) return 0;
  if (!partCompletionByDate) return 0;
  let done = 0;
  let total = 0;
  weekPlan.days.forEach((day) => {
    total += 1;
    const parts = partCompletionByDate[day.dateISO] || {};
    if (parts.workout || parts.reset || parts.nutrition) done += 1;
  });
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

async function serveStatic(res) {
  const filePath = path.join(PUBLIC_DIR, "index.html");
  try {
    const html = await fs.readFile(filePath, "utf8");
    const out = html.replace("__IS_DEV__", isDev ? "true" : "false");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(out);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "static_read_failed" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    await serveStatic(res);
    return;
  }

  try {
    if (pathname === "/v1/profile" && req.method === "POST") {
      const body = await parseJson(req);
      const userProfile = normalizeUserProfile(body.userProfile);
      dispatch({ type: "BASELINE_SAVED", payload: { userProfile } });
      dispatch({ type: "ENSURE_WEEK", payload: {} });
      sendJson(res, 200, { ok: true, userProfile: state.userProfile, weekPlan: state.weekPlan });
      return;
    }

    if (pathname === "/v1/plan/week" && req.method === "GET") {
      const date = url.searchParams.get("date") || domain.isoToday();
      if (url.searchParams.get("date")) {
        dispatch({ type: "WEEK_REBUILD", payload: { weekAnchorISO: date } });
      } else {
        dispatch({ type: "ENSURE_WEEK", payload: {} });
      }
      sendJson(res, 200, { ok: true, weekPlan: state.weekPlan });
      return;
    }

    if (pathname === "/v1/plan/day" && req.method === "GET") {
      const dateISO = url.searchParams.get("date");
      if (!dateISO) {
        sendJson(res, 400, { ok: false, error: "date_required" });
        return;
      }
      ensureWeekForDate(dateISO);
      const dayPlan = findDayPlan(dateISO);
      sendJson(res, 200, {
        ok: true,
        dayPlan,
        stressState: state.lastStressStateByDate?.[dateISO] || null,
        weekStartDateISO: state.weekPlan?.startDateISO || null,
      });
      return;
    }

    if (pathname === "/v1/checkin" && req.method === "POST") {
      const body = await parseJson(req);
      const checkIn = body.checkIn;
      const { result } = dispatch({ type: "CHECKIN_SAVED", payload: { checkIn } });
      const dayPlan = findDayPlan(checkIn?.dateISO);
      const tomorrowISO = checkIn?.dateISO ? domain.addDaysISO(checkIn.dateISO, 1) : null;
      const tomorrowPlan = tomorrowISO ? findDayPlan(tomorrowISO) : null;
      sendJson(res, 200, {
        ok: true,
        changedDayISO: result?.changedDayISO || checkIn?.dateISO || null,
        notes: result?.notes || [],
        dayPlan,
        tomorrowPlan: checkIn?.stress >= 7 && checkIn?.sleepQuality <= 5 ? tomorrowPlan : null,
      });
      return;
    }

    if (pathname === "/v1/signal" && req.method === "POST") {
      const body = await parseJson(req);
      const { dateISO, signal } = body;
      const { result } = dispatch({ type: "QUICK_SIGNAL", payload: { dateISO, signal } });
      const dayPlan = findDayPlan(dateISO);
      sendJson(res, 200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        dayPlan,
      });
      return;
    }

    if (pathname === "/v1/bad-day" && req.method === "POST") {
      const body = await parseJson(req);
      const { dateISO } = body;
      const { result } = dispatch({ type: "BAD_DAY_MODE", payload: { dateISO } });
      const dayPlan = findDayPlan(dateISO);
      sendJson(res, 200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        dayPlan,
      });
      return;
    }

    if (pathname === "/v1/feedback" && req.method === "POST") {
      const body = await parseJson(req);
      const { dateISO, helped, reason } = body;
      const { result } = dispatch({ type: "FEEDBACK_SUBMITTED", payload: { dateISO, helped, reason } });
      sendJson(res, 200, {
        ok: true,
        notes: result?.notes || [],
        modifiers: state.modifiers || {},
      });
      return;
    }

    if (pathname === "/v1/complete" && req.method === "POST") {
      const body = await parseJson(req);
      const { dateISO, part } = body;
      dispatch({ type: "TOGGLE_PART_COMPLETION", payload: { dateISO, part } });
      const progress = domain.computeProgress({ checkIns: state.checkIns || [], weekPlan: state.weekPlan, completions: state.completions });
      const anyPartCompletionRate = computeAnyPartCompletionRate(state.weekPlan, state.partCompletionByDate);
      sendJson(res, 200, {
        ok: true,
        partCompletionByDate: state.partCompletionByDate?.[dateISO] || {},
        progress: { ...progress, anyPartCompletionRate },
      });
      return;
    }

    if (pathname === "/v1/progress" && req.method === "GET") {
      const progress = domain.computeProgress({ checkIns: state.checkIns || [], weekPlan: state.weekPlan, completions: state.completions });
      sendJson(res, 200, { ok: true, progress });
      return;
    }

    if (pathname === "/v1/dev/bundle" && req.method === "GET") {
      if (!isDev) {
        sendJson(res, 404, { ok: false, error: "not_found" });
        return;
      }
      const lastCheckIns = (state.checkIns || []).slice(0, 14);
      const stressKeys = Object.keys(state.lastStressStateByDate || {}).sort().slice(-7);
      const stressSubset = {};
      stressKeys.forEach((key) => {
        stressSubset[key] = state.lastStressStateByDate[key];
      });
      sendJson(res, 200, {
        ok: true,
        userProfile: state.userProfile,
        weekPlan: state.weekPlan,
        checkIns: lastCheckIns,
        lastStressStateByDate: stressSubset,
        modifiers: state.modifiers,
        ruleToggles: state.ruleToggles,
        eventLog: (state.eventLog || []).slice(0, 30),
        versions: {
          pipeline: state.weekPlan?.days?.[0]?.pipelineVersion ?? null,
          schema: state.schemaVersion ?? null,
        },
      });
      return;
    }

    if (pathname === "/v1/dev/scenario" && req.method === "POST") {
      if (!isDev) {
        sendJson(res, 404, { ok: false, error: "not_found" });
        return;
      }
      const body = await parseJson(req);
      const scenarioId = body.scenarioId;
      dispatch({ type: "APPLY_SCENARIO", payload: { scenarioId } });
      const dayPlan = findDayPlan(domain.isoToday());
      sendJson(res, 200, { ok: true, scenarioId, dayPlan });
      return;
    }

    if (pathname === "/v1/dev/snapshot/run" && req.method === "POST") {
      if (!isDev) {
        sendJson(res, 404, { ok: false, error: "not_found" });
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
      sendJson(res, 200, { ok: true, results });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  } catch (err) {
    const status = err?.status || 500;
    sendJson(res, status, { ok: false, error: err?.message || "server_error" });
  }
});

server.listen(PORT, () => {
  console.log(`LiveNew server listening on http://localhost:${PORT}`);
});
