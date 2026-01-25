import { create } from "zustand";
import { loadJSON, removeJSON, saveJSON } from "./persist";
import {
  isoToday,
  weekStartMonday,
  addDaysISO,
  assignStressProfile,
  generateWeekPlan,
  adaptPlan,
} from "../domain";

const STORAGE_KEY = "livegood:v1";
const SCHEMA_VERSION = 1;

function buildCheckInsByDate(checkIns) {
  const map = {};
  checkIns.forEach((c) => {
    map[c.dateISO] = c;
  });
  return map;
}

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
    createdAtISO: baseline.createdAtISO || isoToday(),
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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addHistoryEntry(history, { reason, dateISO, beforeDay, afterDay }) {
  if (!beforeDay || !afterDay) return history;
  if (JSON.stringify(beforeDay) === JSON.stringify(afterDay)) return history;
  const entry = {
    id: Math.random().toString(36).slice(2),
    atISO: new Date().toISOString(),
    reason,
    dateISO,
    beforeDay: deepClone(beforeDay),
    afterDay: deepClone(afterDay),
  };
  return [entry, ...history].slice(0, 50);
}

function findDay(plan, dateISO) {
  return plan?.days?.find((d) => d.dateISO === dateISO) || null;
}

function buildStressStateMap(user, plan, checkInsByDate) {
  const map = {};
  plan.days.forEach((day) => {
    const checkIn = checkInsByDate ? checkInsByDate[day.dateISO] : undefined;
    map[day.dateISO] = assignStressProfile({ user, dateISO: day.dateISO, checkIn });
  });
  return map;
}

export const useAppStore = create((set, get) => ({
  schemaVersion: SCHEMA_VERSION,
  userProfile: null,
  weekPlan: null,
  checkIns: [],
  lastStressStateByDate: {},
  completions: {},
  stressors: [],
  history: [],

  getTodayISO: () => isoToday(),

  hydrate: async () => {
    const saved = await loadJSON(STORAGE_KEY);
    if (!saved) return;
    const savedVersion = saved.schemaVersion ?? 1;
    if (savedVersion !== SCHEMA_VERSION) {
      const reset = {
        schemaVersion: SCHEMA_VERSION,
        userProfile: null,
        weekPlan: null,
        checkIns: [],
        completions: {},
        stressors: [],
        lastStressStateByDate: {},
        history: [],
      };
      set({
        userProfile: reset.userProfile,
        weekPlan: reset.weekPlan,
        checkIns: reset.checkIns,
        completions: reset.completions,
        stressors: reset.stressors,
        lastStressStateByDate: reset.lastStressStateByDate,
        history: reset.history,
      });
      await saveJSON(STORAGE_KEY, reset);
      return;
    }

    const hydratedCheckIns = (saved.checkIns ?? []).map(normalizeCheckIn);
    const userProfile = saved.userProfile ?? mapBaselineToProfile(saved.baseline);
    const weekPlan =
      saved.weekPlan &&
      Array.isArray(saved.weekPlan.days) &&
      saved.weekPlan.days[0] &&
      saved.weekPlan.days[0].workout
        ? saved.weekPlan
        : null;
    const needsPersist = Boolean(!saved.userProfile && saved.baseline);

    set({
      userProfile: userProfile ?? null,
      weekPlan,
      checkIns: hydratedCheckIns,
      completions: saved.completions ?? {},
      stressors: saved.stressors ?? [],
      lastStressStateByDate: saved.lastStressStateByDate ?? {},
      history: saved.history ?? [],
    });

    if (needsPersist) await persist();
  },

  resetData: async () => {
    await removeJSON(STORAGE_KEY);
    set({
      userProfile: null,
      weekPlan: null,
      checkIns: [],
      completions: {},
      stressors: [],
      lastStressStateByDate: {},
      history: [],
    });
  },

  setUserProfile: async (profile) => {
    set({ userProfile: profile });
    await persist();
  },

  buildWeek: async (weekAnchorISO) => {
    const user = get().userProfile;
    if (!user) return;
    const checkInsByDate = buildCheckInsByDate(get().checkIns);
    const plan = generateWeekPlan({ user, weekAnchorISO, checkInsByDate });
    const lastStressStateByDate = buildStressStateMap(user, plan, checkInsByDate);
    set({ weekPlan: plan, lastStressStateByDate });
    await persist();
  },

  ensureCurrentWeek: async () => {
    const user = get().userProfile;
    if (!user) return;
    const currentWeekStart = weekStartMonday(isoToday());
    const plan = get().weekPlan;
    if (!plan || plan.startDateISO !== currentWeekStart) {
      await get().buildWeek(currentWeekStart);
    }
  },

  addCheckIn: async (checkIn) => {
    const state = get();
    const normalized = normalizeCheckIn(checkIn);
    const filtered = state.checkIns.filter((item) => item.dateISO !== normalized.dateISO);
    const nextCheckIns = [normalized, ...filtered].slice(0, 60);
    const checkInsByDate = buildCheckInsByDate(nextCheckIns);
    let lastStressStateByDate = { ...(state.lastStressStateByDate || {}) };

    let nextPlan = state.weekPlan;
    if (state.userProfile) {
      const stressState = assignStressProfile({
        user: state.userProfile,
        dateISO: normalized.dateISO,
        checkIn: normalized,
      });
      lastStressStateByDate[normalized.dateISO] = stressState;

      if (!nextPlan || nextPlan.startDateISO !== weekStartMonday(normalized.dateISO)) {
        nextPlan = generateWeekPlan({
          user: state.userProfile,
          weekAnchorISO: normalized.dateISO,
          checkInsByDate,
        });
      }

      if (nextPlan) {
        const adapted = adaptPlan({
          weekPlan: nextPlan,
          user: state.userProfile,
          todayISO: normalized.dateISO,
          checkIn: normalized,
          checkInsByDate,
        });
        nextPlan = adapted.weekPlan;
        lastStressStateByDate = {
          ...lastStressStateByDate,
          ...buildStressStateMap(state.userProfile, nextPlan, checkInsByDate),
        };
      }
    }

    let history = state.history;
    if (state.weekPlan && nextPlan) {
      history = addHistoryEntry(history, {
        reason: "Check-in update",
        dateISO: normalized.dateISO,
        beforeDay: findDay(state.weekPlan, normalized.dateISO),
        afterDay: findDay(nextPlan, normalized.dateISO),
      });

      if (normalized.stress >= 7 && normalized.sleepQuality <= 5) {
        const tomorrowISO = addDaysISO(normalized.dateISO, 1);
        history = addHistoryEntry(history, {
          reason: "Tomorrow adjusted for high stress + poor sleep",
          dateISO: tomorrowISO,
          beforeDay: findDay(state.weekPlan, tomorrowISO),
          afterDay: findDay(nextPlan, tomorrowISO),
        });
      }
    }

    set({ checkIns: nextCheckIns, weekPlan: nextPlan, lastStressStateByDate, history });
    await persist();
  },

  applyQuickSignal: async (signal, todayISO) => {
    const state = get();
    if (!state.weekPlan || !state.userProfile) return;
    const checkInsByDate = buildCheckInsByDate(state.checkIns);
    const adapted = adaptPlan({
      weekPlan: state.weekPlan,
      user: state.userProfile,
      todayISO,
      signal,
      checkInsByDate,
    });

    let history = state.history;
    history = addHistoryEntry(history, {
      reason: `Signal: ${signal}`,
      dateISO: todayISO,
      beforeDay: findDay(state.weekPlan, todayISO),
      afterDay: findDay(adapted.weekPlan, todayISO),
    });

    set({ weekPlan: adapted.weekPlan, history });
    await persist();
  },

  undoLastChange: async () => {
    const state = get();
    if (!state.history.length || !state.weekPlan) return;
    const [latest, ...rest] = state.history;
    const idx = state.weekPlan.days.findIndex((d) => d.dateISO === latest.dateISO);
    if (idx === -1) return;
    const nextDays = state.weekPlan.days.slice();
    nextDays[idx] = latest.beforeDay;
    set({ weekPlan: { ...state.weekPlan, days: nextDays }, history: rest });
    await persist();
  },

  toggleCompletion: async (blockId) => {
    const current = get().completions;
    const next = { ...current, [blockId]: !current[blockId] };
    set({ completions: next });
    await persist();
  },

  addStressor: async (kind, dateISO) => {
    const state = get();
    if (state.stressors.some((s) => s.dateISO === dateISO && s.kind === kind)) return;
    const id = Math.random().toString(36).slice(2);
    const nextStressors = [{ id, dateISO, kind }, ...state.stressors];

    let nextPlan = state.weekPlan;
    let history = state.history;
    if (nextPlan && state.userProfile) {
      const checkInsByDate = buildCheckInsByDate(state.checkIns);
      const adapted = adaptPlan({
        weekPlan: nextPlan,
        user: state.userProfile,
        todayISO: dateISO,
        signal: "im_stressed",
        checkInsByDate,
      });
      nextPlan = adapted.weekPlan;
      history = addHistoryEntry(history, {
        reason: `Stressor: ${kind}`,
        dateISO,
        beforeDay: findDay(state.weekPlan, dateISO),
        afterDay: findDay(nextPlan, dateISO),
      });
    }

    set({ stressors: nextStressors, weekPlan: nextPlan, history });
    await persist();
  },
}));

async function persist() {
  const s = useAppStore.getState();
  await saveJSON(STORAGE_KEY, {
    schemaVersion: SCHEMA_VERSION,
    userProfile: s.userProfile,
    weekPlan: s.weekPlan,
    checkIns: s.checkIns,
    completions: s.completions,
    stressors: s.stressors,
    lastStressStateByDate: s.lastStressStateByDate,
    history: s.history,
  });
}
