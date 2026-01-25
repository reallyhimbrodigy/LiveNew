import { reduceEvent, initialStatePatch } from "../state/engine";
import * as domain from "../domain";
import { getScenarioById } from "./scenarios";

const SNAPSHOT_FILES = {
  no_checkins: "no_checkins.json",
  poor_sleep_day: "poor_sleep_day.json",
  wired_day: "wired_day.json",
  ten_min_day: "ten_min_day.json",
  busy_day: "busy_day.json",
  bad_day_mode: "bad_day_mode.json",
  feedback_too_hard: "feedback_too_hard.json",
  feedback_not_relevant: "feedback_not_relevant.json",
  balanced_day: "balanced_day.json",
  depleted_day: "depleted_day.json",
};

export const SNAPSHOT_IDS = Object.keys(SNAPSHOT_FILES);

let snapshotCache = null;

function loadSnapshotsSync() {
  if (snapshotCache) return snapshotCache;
  if (typeof require !== "undefined") {
    snapshotCache = {};
    Object.entries(SNAPSHOT_FILES).forEach(([id, file]) => {
      snapshotCache[id] = require(`./scenarioSnapshots/${file}`);
    });
    return snapshotCache;
  }
  return null;
}

async function loadSnapshots() {
  if (snapshotCache) return snapshotCache;
  const sync = loadSnapshotsSync();
  if (sync) return sync;

  const fs = await import("fs/promises");
  const path = await import("path");
  const baseDir = path.join(process.cwd(), "src", "dev", "scenarioSnapshots");
  const entries = await Promise.all(
    Object.entries(SNAPSHOT_FILES).map(async ([id, file]) => {
      const raw = await fs.readFile(path.join(baseDir, file), "utf8");
      return [id, JSON.parse(raw)];
    })
  );
  snapshotCache = Object.fromEntries(entries);
  return snapshotCache;
}

export function normalizeDayPlan(dayPlan) {
  return {
    focus: dayPlan?.focus || null,
    profile: dayPlan?.profile || null,
    workout: { id: dayPlan?.workout?.id || null, minutes: dayPlan?.workout?.minutes || null },
    reset: { id: dayPlan?.reset?.id || null, minutes: dayPlan?.reset?.minutes || null },
    nutrition: { id: dayPlan?.nutrition?.id || null },
    rationaleFirst2: (dayPlan?.rationale || []).slice(0, 2),
  };
}

export function diffSnapshot(expected, actual) {
  const diffs = [];
  walk(expected, actual, "");
  return diffs;

  function walk(exp, act, path) {
    if (Array.isArray(exp)) {
      if (!Array.isArray(act)) {
        diffs.push(`${path}: expected array, got ${typeof act}`);
        return;
      }
      if (exp.length !== act.length) {
        diffs.push(`${path}: length ${exp.length} != ${act.length}`);
      }
      exp.forEach((item, idx) => walk(item, act[idx], `${path}[${idx}]`));
      return;
    }
    if (exp && typeof exp === "object") {
      const keys = new Set([...Object.keys(exp), ...Object.keys(act || {})]);
      keys.forEach((key) => {
        const nextPath = path ? `${path}.${key}` : key;
        walk(exp[key], act ? act[key] : undefined, nextPath);
      });
      return;
    }
    if (exp !== act) {
      diffs.push(`${path}: expected ${JSON.stringify(exp)} got ${JSON.stringify(act)}`);
    }
  }
}

export async function runSnapshotCheck(scenarioId, state, ctx) {
  const snapshots = await loadSnapshots();
  const snap = snapshots[scenarioId];
  if (!snap) return { ok: false, diffs: [`Missing snapshot for ${scenarioId}`] };

  const now = ctx?.now || { todayISO: domain.isoToday(), atISO: new Date().toISOString() };
  const ruleToggles = ctx?.ruleToggles || initialStatePatch().ruleToggles;
  const baseState = {
    ...(initialStatePatch()),
    schemaVersion: state?.schemaVersion ?? 0,
    userProfile: null,
    weekPlan: null,
    checkIns: [],
    lastStressStateByDate: {},
    completions: state?.completions ?? {},
    stressors: state?.stressors ?? [],
    history: [],
    feedback: [],
    modifiers: {},
    eventLog: [],
    partCompletionByDate: state?.partCompletionByDate ?? {},
    ruleToggles,
  };

  const ctxForEngine = {
    domain,
    now,
    ruleToggles,
    scenarios: { getScenarioById },
  };

  let result = reduceEvent(baseState, { type: "APPLY_SCENARIO", payload: { scenarioId }, atISO: now.atISO }, ctxForEngine);
  let nextState = result.nextState;

  const scenario = getScenarioById(scenarioId);
  if (scenario?.events) {
    const events = typeof scenario.events === "function" ? scenario.events({ todayISO: now.todayISO }) : scenario.events;
    (events || []).forEach((evt) => {
      if (!evt) return;
      result = reduceEvent(nextState, { type: evt.type, payload: evt.payload, atISO: now.atISO }, ctxForEngine);
      nextState = result.nextState;
    });
  }

  const dateISO = snap.dateISO === "TODAY" ? now.todayISO : snap.dateISO;
  const dayPlan = nextState.weekPlan?.days?.find((d) => d.dateISO === dateISO);
  if (!dayPlan) {
    return { ok: false, diffs: [`No day plan for ${dateISO}`] };
  }

  const expected = {
    ...snap,
    dateISO,
  };
  const actual = {
    scenarioId,
    pipelineVersion: dayPlan.pipelineVersion ?? null,
    dateISO,
    dayPlan: normalizeDayPlan(dayPlan),
  };

  const diffs = diffSnapshot(expected, actual);
  return { ok: diffs.length === 0, diffs };
}
