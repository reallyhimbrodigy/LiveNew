import { create } from "zustand";
import { loadJSON, removeJSON, saveJSON } from "./persist";
import {
  isoToday,
  weekStartMonday,
  addDaysISO,
  assignStressProfile,
  generateWeekPlan,
  adaptPlan,
  buildDayPlan,
} from "../domain";

const STORAGE_KEY = "livegood:v1";
const SCHEMA_VERSION = 2;

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

function isActiveUntil(dateISO, untilISO) {
  if (!untilISO) return true;
  return dateISO <= untilISO;
}

function cleanupModifiers(modifiers, todayISO) {
  const next = { ...(modifiers || {}) };
  if (next.intensityCapUntilISO && todayISO > next.intensityCapUntilISO) {
    delete next.intensityCapUntilISO;
    delete next.intensityCapValue;
  }
  if (next.preferredWindowBiasUntilISO && todayISO > next.preferredWindowBiasUntilISO) {
    delete next.preferredWindowBiasUntilISO;
    delete next.preferredWindowBias;
  }
  if (next.noveltyRotationBoostUntilISO && todayISO > next.noveltyRotationBoostUntilISO) {
    delete next.noveltyRotationBoostUntilISO;
    next.noveltyRotationBoost = false;
  }
  return next;
}

function effectiveUserForDate(user, modifiers, dateISO) {
  const mod = modifiers || {};
  const biasActive = mod.preferredWindowBias && isActiveUntil(dateISO, mod.preferredWindowBiasUntilISO);
  if (!biasActive) return user;
  const windows = Array.isArray(user.preferredWorkoutWindows) ? user.preferredWorkoutWindows : [];
  const nextWindows = [mod.preferredWindowBias, ...windows.filter((w) => w !== mod.preferredWindowBias)];
  return { ...user, preferredWorkoutWindows: nextWindows };
}

function modifiersForDate(modifiers, dateISO) {
  const mod = modifiers || {};
  const intensityActive = mod.intensityCapValue != null && isActiveUntil(dateISO, mod.intensityCapUntilISO);
  const noveltyActive = mod.noveltyRotationBoost && isActiveUntil(dateISO, mod.noveltyRotationBoostUntilISO);
  return {
    intensityCap: intensityActive ? mod.intensityCapValue : null,
    qualityRules: { avoidNoveltyWindowDays: noveltyActive ? 3 : 2 },
  };
}

function rebuildDayInPlan({ user, weekPlan, dateISO, checkInsByDate, overrides, qualityRules }) {
  const idx = weekPlan.days.findIndex((d) => d.dateISO === dateISO);
  if (idx === -1) return { weekPlan, dayPlan: null };

  const recentNoveltyGroups = collectRecentNoveltyGroups(weekPlan.days, idx, 2);
  const { dayPlan } = buildDayPlan({
    user,
    dateISO,
    checkIn: checkInsByDate ? checkInsByDate[dateISO] : undefined,
    checkInsByDate,
    weekContext: { busyDays: user.busyDays || [], recentNoveltyGroups },
    overrides,
    qualityRules,
  });

  const nextDays = weekPlan.days.slice();
  nextDays[idx] = dayPlan;
  return { weekPlan: { ...weekPlan, days: nextDays }, dayPlan };
}

function nextWindowFrom(current) {
  const cycle = ["AM", "MIDDAY", "PM"];
  const idx = cycle.indexOf(current);
  if (idx === -1) return "AM";
  return cycle[(idx + 1) % cycle.length];
}

function collectRecentNoveltyGroups(days, idx, windowDays) {
  const start = Math.max(0, idx - windowDays);
  const recent = days.slice(start, idx);
  const groups = [];
  recent.forEach((day) => {
    if (day.selectedNoveltyGroups) {
      Object.values(day.selectedNoveltyGroups).forEach((g) => {
        if (g) groups.push(g);
      });
    } else {
      if (day.workout?.noveltyGroup) groups.push(day.workout.noveltyGroup);
      if (day.nutrition?.noveltyGroup) groups.push(day.nutrition.noveltyGroup);
      if (day.reset?.noveltyGroup) groups.push(day.reset.noveltyGroup);
    }
  });
  return groups;
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
  feedback: [],
  modifiers: {},

  getTodayISO: () => isoToday(),

  hydrate: async () => {
    const saved = await loadJSON(STORAGE_KEY);
    if (!saved) return;
    const savedVersion = saved.schemaVersion ?? 1;

    if (savedVersion > SCHEMA_VERSION) {
      await removeJSON(STORAGE_KEY);
      set({
        userProfile: null,
        weekPlan: null,
        checkIns: [],
        completions: {},
        stressors: [],
        lastStressStateByDate: {},
        history: [],
        feedback: [],
        modifiers: {},
      });
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

    const nextModifiers = cleanupModifiers(saved.modifiers ?? {}, isoToday());

    set({
      userProfile: userProfile ?? null,
      weekPlan,
      checkIns: hydratedCheckIns,
      completions: saved.completions ?? {},
      stressors: saved.stressors ?? [],
      lastStressStateByDate: saved.lastStressStateByDate ?? {},
      history: saved.history ?? [],
      feedback: saved.feedback ?? [],
      modifiers: nextModifiers,
    });

    if (savedVersion !== SCHEMA_VERSION) await persist();
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
      feedback: [],
      modifiers: {},
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
    const modifiers = cleanupModifiers(get().modifiers, weekAnchorISO);
    const effectiveUser = effectiveUserForDate(user, modifiers, weekAnchorISO);

    let plan = generateWeekPlan({ user: effectiveUser, weekAnchorISO, checkInsByDate });

    if (modifiers.stabilizeTomorrow) {
      const tomorrowISO = addDaysISO(isoToday(), 1);
      if (plan.days.some((d) => d.dateISO === tomorrowISO)) {
        const res = rebuildDayInPlan({
          user: effectiveUser,
          weekPlan: plan,
          dateISO: tomorrowISO,
          checkInsByDate,
          overrides: { focusBias: "stabilize" },
          qualityRules: { avoidNoveltyWindowDays: 2 },
        });
        plan = res.weekPlan;
      }
      modifiers.stabilizeTomorrow = false;
    }

    const lastStressStateByDate = buildStressStateMap(effectiveUser, plan, checkInsByDate);
    set({ weekPlan: plan, lastStressStateByDate, modifiers });
    await persist();
  },

  ensureCurrentWeek: async () => {
    const user = get().userProfile;
    if (!user) return;

    const currentWeekStart = weekStartMonday(isoToday());
    const plan = get().weekPlan;
    if (!plan || plan.startDateISO !== currentWeekStart) {
      await get().buildWeek(currentWeekStart);
      return;
    }

    const modifiers = cleanupModifiers(get().modifiers, isoToday());
    if (modifiers.stabilizeTomorrow) {
      const checkInsByDate = buildCheckInsByDate(get().checkIns);
      const effectiveUser = effectiveUserForDate(user, modifiers, isoToday());
      const tomorrowISO = addDaysISO(isoToday(), 1);
      if (plan.days.some((d) => d.dateISO === tomorrowISO)) {
        const res = rebuildDayInPlan({
          user: effectiveUser,
          weekPlan: plan,
          dateISO: tomorrowISO,
          checkInsByDate,
          overrides: { focusBias: "stabilize" },
          qualityRules: { avoidNoveltyWindowDays: 2 },
        });
        const nextPlan = res.weekPlan;
        const lastStressStateByDate = buildStressStateMap(effectiveUser, nextPlan, checkInsByDate);
        modifiers.stabilizeTomorrow = false;
        set({ weekPlan: nextPlan, lastStressStateByDate, modifiers });
        await persist();
      }
    }
  },

  addCheckIn: async (checkIn) => {
    const state = get();
    const normalized = normalizeCheckIn(checkIn);
    const filtered = state.checkIns.filter((item) => item.dateISO !== normalized.dateISO);
    const nextCheckIns = [normalized, ...filtered].slice(0, 60);
    const checkInsByDate = buildCheckInsByDate(nextCheckIns);

    let modifiers = cleanupModifiers(state.modifiers, normalized.dateISO);
    const effectiveUser = state.userProfile
      ? effectiveUserForDate(state.userProfile, modifiers, normalized.dateISO)
      : null;
    const { intensityCap, qualityRules } = modifiersForDate(modifiers, normalized.dateISO);

    let nextPlan = state.weekPlan;
    if (state.userProfile) {
      if (!nextPlan || nextPlan.startDateISO !== weekStartMonday(normalized.dateISO)) {
        nextPlan = generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO: normalized.dateISO,
          checkInsByDate,
        });
      }

      if (nextPlan) {
        const adapted = adaptPlan({
          weekPlan: nextPlan,
          user: effectiveUser,
          todayISO: normalized.dateISO,
          checkIn: normalized,
          checkInsByDate,
          overridesBase: intensityCap != null ? { intensityCap } : null,
          qualityRules,
          weekContextBase: { busyDays: effectiveUser.busyDays || [] },
        });
        nextPlan = adapted.weekPlan;
      }
    }

    const lastStressStateByDate = nextPlan && effectiveUser
      ? buildStressStateMap(effectiveUser, nextPlan, checkInsByDate)
      : state.lastStressStateByDate;

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

    set({ checkIns: nextCheckIns, weekPlan: nextPlan, lastStressStateByDate, history, modifiers });
    await persist();
  },

  applyQuickSignal: async (signal, todayISO) => {
    const state = get();
    if (!state.weekPlan || !state.userProfile) return;

    const checkInsByDate = buildCheckInsByDate(state.checkIns);
    const modifiers = cleanupModifiers(state.modifiers, todayISO);
    const effectiveUser = effectiveUserForDate(state.userProfile, modifiers, todayISO);
    const { intensityCap, qualityRules } = modifiersForDate(modifiers, todayISO);

    const adapted = adaptPlan({
      weekPlan: state.weekPlan,
      user: effectiveUser,
      todayISO,
      signal,
      checkInsByDate,
      overridesBase: intensityCap != null ? { intensityCap } : null,
      qualityRules,
      weekContextBase: { busyDays: effectiveUser.busyDays || [] },
    });

    let history = state.history;
    history = addHistoryEntry(history, {
      reason: `Signal: ${signal}`,
      dateISO: todayISO,
      beforeDay: findDay(state.weekPlan, todayISO),
      afterDay: findDay(adapted.weekPlan, todayISO),
    });

    const lastStressStateByDate = buildStressStateMap(effectiveUser, adapted.weekPlan, checkInsByDate);

    set({ weekPlan: adapted.weekPlan, history, lastStressStateByDate, modifiers });
    await persist();
  },

  activateBadDayMode: async (todayISO) => {
    const state = get();
    if (!state.weekPlan || !state.userProfile) return;

    const checkInsByDate = buildCheckInsByDate(state.checkIns);
    let modifiers = cleanupModifiers(state.modifiers, todayISO);
    const effectiveUser = effectiveUserForDate(state.userProfile, modifiers, todayISO);
    const { intensityCap, qualityRules } = modifiersForDate(modifiers, todayISO);

    const beforeDay = findDay(state.weekPlan, todayISO);
    const res = rebuildDayInPlan({
      user: effectiveUser,
      weekPlan: state.weekPlan,
      dateISO: todayISO,
      checkInsByDate,
      overrides: {
        forceBadDayMode: true,
        intensityCap: intensityCap != null ? intensityCap : 2,
      },
      qualityRules,
    });

    modifiers.stabilizeTomorrow = true;

    const history = addHistoryEntry(state.history, {
      reason: "Bad day mode",
      dateISO: todayISO,
      beforeDay,
      afterDay: findDay(res.weekPlan, todayISO),
    });

    const lastStressStateByDate = buildStressStateMap(effectiveUser, res.weekPlan, checkInsByDate);

    set({ weekPlan: res.weekPlan, history, modifiers, lastStressStateByDate });
    await persist();
  },

  submitFeedback: async ({ dateISO, helped, reason }) => {
    const state = get();
    if (!state.userProfile || !state.weekPlan) return;

    const feedbackEntry = {
      id: Math.random().toString(36).slice(2),
      dateISO,
      helped,
      reason: reason || undefined,
      atISO: new Date().toISOString(),
    };

    let feedback = [feedbackEntry, ...state.feedback].slice(0, 120);
    let modifiers = cleanupModifiers(state.modifiers, dateISO);

    if (reason === "too_hard") {
      modifiers.intensityCapValue = 3;
      modifiers.intensityCapUntilISO = addDaysISO(dateISO, 3);
    } else if (reason === "too_easy") {
      delete modifiers.intensityCapValue;
      delete modifiers.intensityCapUntilISO;
    } else if (reason === "wrong_time") {
      const day = findDay(state.weekPlan, dateISO);
      const currentWindow = day?.workoutWindow || "AM";
      modifiers.preferredWindowBias = nextWindowFrom(currentWindow);
      modifiers.preferredWindowBiasUntilISO = addDaysISO(dateISO, 7);
    } else if (reason === "not_relevant") {
      modifiers.noveltyRotationBoost = true;
      modifiers.noveltyRotationBoostUntilISO = addDaysISO(dateISO, 7);
    }

    const checkInsByDate = buildCheckInsByDate(state.checkIns);
    const effectiveUser = effectiveUserForDate(state.userProfile, modifiers, dateISO);

    let nextPlan = state.weekPlan;
    let history = state.history;

    const tomorrowISO = addDaysISO(dateISO, 1);
    const { intensityCap, qualityRules } = modifiersForDate(modifiers, tomorrowISO);
    if (nextPlan.days.some((d) => d.dateISO === tomorrowISO)) {
      const beforeDay = findDay(nextPlan, tomorrowISO);
      const res = rebuildDayInPlan({
        user: effectiveUser,
        weekPlan: nextPlan,
        dateISO: tomorrowISO,
        checkInsByDate,
        overrides: intensityCap != null ? { intensityCap } : null,
        qualityRules,
      });
      nextPlan = res.weekPlan;
      history = addHistoryEntry(history, {
        reason: "Feedback adjustment",
        dateISO: tomorrowISO,
        beforeDay,
        afterDay: findDay(nextPlan, tomorrowISO),
      });
    }

    const lastStressStateByDate = buildStressStateMap(effectiveUser, nextPlan, checkInsByDate);

    set({ feedback, modifiers, weekPlan: nextPlan, history, lastStressStateByDate });
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

    const checkInsByDate = buildCheckInsByDate(state.checkIns);
    const effectiveUser = state.userProfile;
    const lastStressStateByDate = effectiveUser
      ? buildStressStateMap(effectiveUser, { ...state.weekPlan, days: nextDays }, checkInsByDate)
      : state.lastStressStateByDate;

    set({ weekPlan: { ...state.weekPlan, days: nextDays }, history: rest, lastStressStateByDate });
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
      const modifiers = cleanupModifiers(state.modifiers, dateISO);
      const effectiveUser = effectiveUserForDate(state.userProfile, modifiers, dateISO);
      const { intensityCap, qualityRules } = modifiersForDate(modifiers, dateISO);

      const adapted = adaptPlan({
        weekPlan: nextPlan,
        user: effectiveUser,
        todayISO: dateISO,
        signal: "im_stressed",
        checkInsByDate,
        overridesBase: intensityCap != null ? { intensityCap } : null,
        qualityRules,
        weekContextBase: { busyDays: effectiveUser.busyDays || [] },
      });

      nextPlan = adapted.weekPlan;
      history = addHistoryEntry(history, {
        reason: `Stressor: ${kind}`,
        dateISO,
        beforeDay: findDay(state.weekPlan, dateISO),
        afterDay: findDay(nextPlan, dateISO),
      });

      const lastStressStateByDate = buildStressStateMap(effectiveUser, nextPlan, checkInsByDate);
      set({ stressors: nextStressors, weekPlan: nextPlan, history, lastStressStateByDate, modifiers });
      await persist();
      return;
    }

    set({ stressors: nextStressors });
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
    feedback: s.feedback,
    modifiers: s.modifiers,
  });
}
