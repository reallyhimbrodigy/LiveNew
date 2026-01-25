import { create } from "zustand";
import { loadJSON, removeJSON, saveJSON } from "./persist";
import { isoToday, weekStartMonday, assignStressProfile, generateWeekPlan, adaptPlan } from "../domain";

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
  };
}

export const useAppStore = create((set, get) => ({
  schemaVersion: SCHEMA_VERSION,
  userProfile: null,
  weekPlan: null,
  checkIns: [],
  lastStressStateByDate: {},
  completions: {},
  stressors: [],

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
      };
      set({
        userProfile: reset.userProfile,
        weekPlan: reset.weekPlan,
        checkIns: reset.checkIns,
        completions: reset.completions,
        stressors: reset.stressors,
        lastStressStateByDate: reset.lastStressStateByDate,
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
    const plan = generateWeekPlan({ user, weekAnchorISO, checkInsByDate, wearablesByDate: undefined });
    set({ weekPlan: plan });
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
    const lastStressStateByDate = { ...(state.lastStressStateByDate || {}) };

    let nextPlan = state.weekPlan;
    if (state.userProfile) {
      const stressState = assignStressProfile({
        user: state.userProfile,
        dateISO: normalized.dateISO,
        checkIn: normalized,
        wearable: undefined,
      });
      lastStressStateByDate[normalized.dateISO] = stressState;

      if (!nextPlan || nextPlan.startDateISO !== weekStartMonday(normalized.dateISO)) {
        const checkInsByDate = buildCheckInsByDate(nextCheckIns);
        nextPlan = generateWeekPlan({
          user: state.userProfile,
          weekAnchorISO: normalized.dateISO,
          checkInsByDate,
          wearablesByDate: undefined,
        });
      }

      if (nextPlan) {
        const adapted = adaptPlan({ weekPlan: nextPlan, todayISO: normalized.dateISO, checkIn: normalized });
        nextPlan = adapted.weekPlan;
      }
    }

    set({ checkIns: nextCheckIns, weekPlan: nextPlan, lastStressStateByDate });
    await persist();
  },

  applyQuickSignal: async (signal, todayISO) => {
    const state = get();
    if (!state.weekPlan) return;
    const adapted = adaptPlan({ weekPlan: state.weekPlan, todayISO, signal });
    set({ weekPlan: adapted.weekPlan });
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
    if (nextPlan) {
      const adapted = adaptPlan({ weekPlan: nextPlan, todayISO: dateISO, signal: "im_stressed" });
      nextPlan = adapted.weekPlan;
    }
    set({ stressors: nextStressors, weekPlan: nextPlan });
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
  });
}
