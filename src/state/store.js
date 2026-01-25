import { create } from "zustand";
import { loadJSON, removeJSON, enqueuePersist, clearPersistQueue } from "./persist";
import * as domain from "../domain";
import { reduceEvent, initialStatePatch } from "./engine";
import { getScenarioById, SCENARIOS } from "../dev/scenarios";

const STORAGE_KEY = "livegood:v1";
const SCHEMA_VERSION = 4;

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCheckIn(checkIn) {
  return {
    ...checkIn,
    stress: toNumber(checkIn.stress, 6),
    sleepQuality: toNumber(checkIn.sleepQuality, 6),
    energy: toNumber(checkIn.energy, 6),
    timeAvailableMin: toNumber(checkIn.timeAvailableMin, 20),
  };
}

function mapBaselineToProfile(baseline) {
  if (!baseline) return null;
  const wakeTime = baseline.wakeTime || "07:00";
  const bedTime = baseline.bedTime || baseline.bedtime || "23:00";
  return {
    ...baseline,
    id: baseline.id || Math.random().toString(36).slice(2),
    createdAtISO: baseline.createdAtISO || domain.isoToday(),
    wakeTime,
    bedTime,
    sleepRegularity: toNumber(baseline.sleepRegularity, 5),
    caffeineCupsPerDay: toNumber(baseline.caffeineCupsPerDay ?? baseline.caffeineCups, 1),
    lateCaffeineDaysPerWeek: toNumber(baseline.lateCaffeineDaysPerWeek, 1),
    sunlightMinutesPerDay: toNumber(baseline.sunlightMinutesPerDay ?? baseline.sunlightMinsPerDay, 10),
    lateScreenMinutesPerNight: toNumber(baseline.lateScreenMinutesPerNight ?? baseline.lateScreenMins, 45),
    alcoholNightsPerWeek: toNumber(baseline.alcoholNightsPerWeek, 1),
    mealTimingConsistency: toNumber(baseline.mealTimingConsistency, 5),
    preferredWorkoutWindows: Array.isArray(baseline.preferredWorkoutWindows) ? baseline.preferredWorkoutWindows : ["PM"],
    busyDays: Array.isArray(baseline.busyDays) ? baseline.busyDays : [],
  };
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

function applyLogEvent(state, logEvent) {
  if (!logEvent) return state;
  const entries = Array.isArray(logEvent) ? logEvent : [logEvent];
  let nextLog = state.eventLog || [];
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
  return { ...state, eventLog: nextLog };
}

function serializeState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    userProfile: state.userProfile,
    weekPlan: state.weekPlan,
    checkIns: state.checkIns,
    completions: state.completions,
    stressors: state.stressors,
    lastStressStateByDate: state.lastStressStateByDate,
    history: state.history,
    feedback: state.feedback,
    modifiers: state.modifiers,
    eventLog: state.eventLog,
    partCompletionByDate: state.partCompletionByDate,
    ruleToggles: state.ruleToggles,
  };
}

function baseState() {
  const patch = initialStatePatch();
  return {
    schemaVersion: SCHEMA_VERSION,
    userProfile: null,
    weekPlan: null,
    checkIns: [],
    lastStressStateByDate: {},
    completions: {},
    stressors: [],
    history: [],
    feedback: patch.feedback,
    modifiers: patch.modifiers,
    eventLog: patch.eventLog,
    partCompletionByDate: patch.partCompletionByDate,
    ruleToggles: patch.ruleToggles,
  };
}

function makeCtx(state) {
  return {
    domain,
    now: { todayISO: domain.isoToday(), atISO: new Date().toISOString() },
    ruleToggles: state.ruleToggles,
    scenarios: { SCENARIOS, getScenarioById },
  };
}

export const useAppStore = create((set, get) => ({
  ...baseState(),

  getTodayISO: () => domain.isoToday(),

  computeAnyPartCompletionRate: () => {
    const s = get();
    return computeAnyPartCompletionRate(s.weekPlan, s.partCompletionByDate);
  },

  hydrate: async () => {
    const saved = await loadJSON(STORAGE_KEY);
    if (!saved) return;

    const savedVersion = saved.schemaVersion ?? 1;
    if (savedVersion > SCHEMA_VERSION) {
      await removeJSON(STORAGE_KEY);
      set(baseState());
      return;
    }

    const patch = initialStatePatch();
    const hydratedCheckIns = (saved.checkIns ?? []).map(normalizeCheckIn);
    const userProfile = saved.userProfile ?? mapBaselineToProfile(saved.baseline);
    const weekPlan = saved.weekPlan && Array.isArray(saved.weekPlan.days) ? saved.weekPlan : null;

    set({
      schemaVersion: SCHEMA_VERSION,
      userProfile: userProfile ?? null,
      weekPlan,
      checkIns: hydratedCheckIns,
      lastStressStateByDate: saved.lastStressStateByDate ?? {},
      completions: saved.completions ?? {},
      stressors: saved.stressors ?? [],
      history: saved.history ?? [],
      feedback: saved.feedback ?? patch.feedback,
      modifiers: saved.modifiers ?? patch.modifiers,
      eventLog: saved.eventLog ?? patch.eventLog,
      partCompletionByDate: saved.partCompletionByDate ?? patch.partCompletionByDate,
      ruleToggles: saved.ruleToggles ?? patch.ruleToggles,
    });

    if (userProfile) {
      await get().ensureCurrentWeek();
    }

    if (savedVersion !== SCHEMA_VERSION) {
      enqueuePersist(STORAGE_KEY, serializeState(get()));
    }
  },

  resetData: async () => {
    clearPersistQueue();
    await removeJSON(STORAGE_KEY);
    set(baseState());
  },

  dispatchEvent: async (type, payload) => {
    const state = get();
    const ctx = makeCtx(state);
    const event = { type, payload, atISO: ctx.now.atISO };
    const { nextState, effects, logEvent } = reduceEvent(state, event, ctx);
    const withLog = applyLogEvent(nextState, logEvent);
    set(withLog);
    if (effects.persist || logEvent) {
      enqueuePersist(STORAGE_KEY, serializeState(withLog));
    }
    return withLog;
  },

  setUserProfile: async (userProfile) => {
    await get().dispatchEvent("BASELINE_SAVED", { userProfile });
  },

  ensureCurrentWeek: async () => {
    await get().dispatchEvent("ENSURE_WEEK", {});
  },

  buildWeek: async (weekAnchorISO) => {
    await get().dispatchEvent("WEEK_REBUILD", { weekAnchorISO });
  },

  addCheckIn: async (checkIn) => {
    await get().dispatchEvent("CHECKIN_SAVED", { checkIn });
  },

  applyQuickSignal: async (signal, dateISO) => {
    await get().dispatchEvent("QUICK_SIGNAL", { signal, dateISO });
  },

  addStressor: async (kind, dateISO) => {
    await get().dispatchEvent("STRESSOR_ADDED", { kind, dateISO });
  },

  activateBadDayMode: async (dateISO) => {
    await get().dispatchEvent("BAD_DAY_MODE", { dateISO });
  },

  submitFeedback: async ({ dateISO, helped, reason }) => {
    await get().dispatchEvent("FEEDBACK_SUBMITTED", { dateISO, helped, reason });
  },

  togglePartCompletion: async (dateISO, part) => {
    await get().dispatchEvent("TOGGLE_PART_COMPLETION", { dateISO, part });
  },

  undoLastChange: async () => {
    await get().dispatchEvent("UNDO_LAST_CHANGE", {});
  },

  dayViewed: async ({ dateISO, pipelineVersion, appliedRules }) => {
    await get().dispatchEvent("DAY_VIEWED", { dateISO, pipelineVersion, appliedRules });
  },

  clearEventLog: async () => {
    await get().dispatchEvent("CLEAR_EVENT_LOG", {});
  },

  applyScenario: async (scenarioId) => {
    await get().dispatchEvent("APPLY_SCENARIO", { scenarioId });
    const scenario = getScenarioById(scenarioId);
    if (!scenario || !scenario.events) return;
    const events = typeof scenario.events === "function" ? scenario.events({ todayISO: domain.isoToday() }) : scenario.events;
    for (const evt of events || []) {
      if (!evt) continue;
      await get().dispatchEvent(evt.type, evt.payload || {});
    }
  },

  setRuleToggles: async (patch) => {
    const current = get().ruleToggles || {};
    const next = { ...current, ...patch };
    set({ ruleToggles: next });
    if (get().userProfile) {
      await get().dispatchEvent("WEEK_REBUILD", { weekAnchorISO: domain.isoToday() });
      return;
    }
    enqueuePersist(STORAGE_KEY, serializeState({ ...get(), ruleToggles: next }));
  },

  logEvent: async (type, payload) => {
    const nextState = applyLogEvent(get(), { type, payload, atISO: new Date().toISOString() });
    set({ eventLog: nextState.eventLog });
    enqueuePersist(STORAGE_KEY, serializeState({ ...get(), eventLog: nextState.eventLog }));
  },

  toggleCompletion: async (blockId) => {
    const current = get().completions;
    const next = { ...current, [blockId]: !current[blockId] };
    set({ completions: next });
    enqueuePersist(STORAGE_KEY, serializeState({ ...get(), completions: next }));
  },

  getDebugBundle: () => {
    const s = get();
    const todayISO = domain.isoToday();
    const lastCheckIns = (s.checkIns || []).slice(0, 14);
    const lastStressKeys = Object.keys(s.lastStressStateByDate || {})
      .sort()
      .slice(-7);
    const stressSubset = {};
    lastStressKeys.forEach((key) => {
      stressSubset[key] = s.lastStressStateByDate[key];
    });
    return {
      userProfile: s.userProfile,
      weekPlan: s.weekPlan,
      checkIns: lastCheckIns,
      lastStressStateByDate: stressSubset,
      modifiers: s.modifiers,
      ruleToggles: s.ruleToggles,
      eventLog: (s.eventLog || []).slice(0, 30),
      pipelineVersion: s.weekPlan?.days?.[0]?.pipelineVersion ?? null,
      schemaVersion: s.schemaVersion,
      todayISO,
    };
  },
}));
