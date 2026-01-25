import { reduceEvent, initialStatePatch } from "../state/engine";
import * as domain from "../domain";
import { getScenarioById } from "./scenarios";

const snapshots = {
  no_checkins: require("./scenarioSnapshots/no_checkins.json"),
  poor_sleep_day: require("./scenarioSnapshots/poor_sleep_day.json"),
  wired_day: require("./scenarioSnapshots/wired_day.json"),
  ten_min_day: require("./scenarioSnapshots/ten_min_day.json"),
  busy_day: require("./scenarioSnapshots/busy_day.json"),
  bad_day_mode: require("./scenarioSnapshots/bad_day_mode.json"),
  feedback_too_hard: require("./scenarioSnapshots/feedback_too_hard.json"),
  feedback_not_relevant: require("./scenarioSnapshots/feedback_not_relevant.json"),
  balanced_day: require("./scenarioSnapshots/balanced_day.json"),
  depleted_day: require("./scenarioSnapshots/depleted_day.json"),
};

export const SNAPSHOT_IDS = Object.keys(snapshots);

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

export function runSnapshotCheck(scenarioId, state, ctx) {
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
