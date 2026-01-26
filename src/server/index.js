import http from "http";
import fs from "fs/promises";
import path from "path";
import * as domain from "../domain/index.js";
import { loadState, enqueueSave } from "../state/storage.js";
import { reduceEvent } from "../state/engine.js";
import { normalizeState, validateState } from "../domain/schema.js";
import { getScenarioById } from "../dev/scenarios.js";
import { runSnapshotCheck, SNAPSHOT_IDS } from "../dev/snapshot.js";
import { toDayContract } from "./dayContract.js";

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isDev = NODE_ENV !== "production";

const PUBLIC_DIR = path.join(process.cwd(), "public");

let state = normalizeState(await loadState());
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
  return { state, result, logEvent };
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

function contentTypeForPath(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  return "application/octet-stream";
}

async function serveFile(res, filePath, { replaceDevFlag } = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const body = replaceDevFlag ? raw.replace("__IS_DEV__", isDev ? "true" : "false") : raw;
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
      const date = url.searchParams.get("date");
      dispatch({ type: "ENSURE_WEEK", payload: {} });
      if (date) {
        dispatch({ type: "WEEK_REBUILD", payload: { weekAnchorISO: date } });
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
      const day = toDayContract(state, dateISO, domain);
      sendJson(res, 200, { ok: true, day });
      return;
    }

    if (pathname === "/v1/checkin" && req.method === "POST") {
      const body = await parseJson(req);
      const checkIn = body.checkIn;
      const { result } = dispatch({ type: "CHECKIN_SAVED", payload: { checkIn } });
      const tomorrowISO = checkIn?.dateISO ? domain.addDaysISO(checkIn.dateISO, 1) : null;
      const day = checkIn?.dateISO ? toDayContract(state, checkIn.dateISO, domain) : null;
      const tomorrow = tomorrowISO ? toDayContract(state, tomorrowISO, domain) : null;
      sendJson(res, 200, {
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
      const { dateISO, signal } = body;
      const { result } = dispatch({ type: "QUICK_SIGNAL", payload: { dateISO, signal } });
      const day = dateISO ? toDayContract(state, dateISO, domain) : null;
      sendJson(res, 200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        day,
      });
      return;
    }

    if (pathname === "/v1/bad-day" && req.method === "POST") {
      const body = await parseJson(req);
      const { dateISO } = body;
      const { result } = dispatch({ type: "BAD_DAY_MODE", payload: { dateISO } });
      const day = dateISO ? toDayContract(state, dateISO, domain) : null;
      sendJson(res, 200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        day,
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
      const progress = domain.computeProgress({
        checkIns: state.checkIns || [],
        weekPlan: state.weekPlan,
        completions: state.partCompletionByDate || {},
      });
      sendJson(res, 200, {
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
      if (!isDev) {
        sendJson(res, 404, { ok: false, error: "not_found" });
        return;
      }
      const body = await parseJson(req);
      const ruleToggles = body.ruleToggles || {};
      const { result } = dispatch({ type: "SET_RULE_TOGGLES", payload: { ruleToggles } });
      sendJson(res, 200, { ok: true, ruleToggles: result?.ruleToggles || state.ruleToggles });
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
      const todayISO = domain.isoToday();
      const day = toDayContract(state, todayISO, domain);
      sendJson(res, 200, { ok: true, scenarioId, day });
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
