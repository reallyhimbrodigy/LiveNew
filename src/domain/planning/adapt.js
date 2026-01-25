import { addDaysISO } from "../utils/date";
import { buildDayPlan } from "./decision";

export function adaptPlan({
  weekPlan,
  user,
  todayISO,
  checkIn,
  signal,
  checkInsByDate,
  overridesBase,
  qualityRules,
  weekContextBase,
}) {
  const notes = [];
  let nextPlan = weekPlan;
  let changedDayISO;

  const baseContext = weekContextBase || { busyDays: user.busyDays || [] };
  const baseQualityRules = {
    avoidNoveltyWindowDays: 2,
    constraintsEnabled: true,
    noveltyEnabled: true,
    ...(qualityRules || {}),
  };

  if (signal) {
    const override = buildOverrideFromSignal({
      signal,
      user,
      todayISO,
      checkIn,
      checkInsByDate,
      qualityRules: baseQualityRules,
    });
    const mergedOverride = { ...(overridesBase || {}), ...(override || {}) };
    const res = rebuildDay({
      user,
      dateISO: todayISO,
      weekPlan: nextPlan,
      checkInsByDate,
      overrides: mergedOverride,
      qualityRules: baseQualityRules,
      weekContextBase: baseContext,
    });
    if (res.changed) {
      nextPlan = res.weekPlan;
      changedDayISO = todayISO;
      notes.push(`Signal applied for ${todayISO}`);
    }
  }

  if (checkIn && checkIn.stress >= 7 && checkIn.sleepQuality <= 5) {
    const tomorrowISO = addDaysISO(todayISO, 1);
    const mergedOverride = { ...(overridesBase || {}), focusBias: "downshift" };
    const res = rebuildDay({
      user,
      dateISO: tomorrowISO,
      weekPlan: nextPlan,
      checkInsByDate,
      overrides: mergedOverride,
      qualityRules: baseQualityRules,
      weekContextBase: baseContext,
    });
    if (res.changed) {
      nextPlan = res.weekPlan;
      changedDayISO = tomorrowISO;
      notes.push("Tomorrow downshifted due to high stress + poor sleep");
    }
  }

  return { weekPlan: nextPlan, changedDayISO, notes };
}

function rebuildDay({ user, dateISO, weekPlan, checkInsByDate, overrides, qualityRules, weekContextBase }) {
  const idx = weekPlan.days.findIndex((d) => d.dateISO === dateISO);
  if (idx === -1) return { weekPlan, changed: false };

  const recentNoveltyGroups = collectRecentNoveltyGroups(weekPlan.days, idx, 2);
  const weekContext = {
    busyDays: (weekContextBase && weekContextBase.busyDays) || user.busyDays || [],
    recentNoveltyGroups,
  };

  const { dayPlan } = buildDayPlan({
    user,
    dateISO,
    checkIn: checkInsByDate ? checkInsByDate[dateISO] : undefined,
    checkInsByDate,
    weekContext,
    overrides,
    qualityRules,
  });

  const nextDays = weekPlan.days.slice();
  const prev = nextDays[idx];
  const changed = JSON.stringify(prev) !== JSON.stringify(dayPlan);
  nextDays[idx] = dayPlan;

  return { weekPlan: { ...weekPlan, days: nextDays }, changed };
}

function buildOverrideFromSignal({ signal, user, todayISO, checkInsByDate, qualityRules }) {
  const checkIn = checkInsByDate ? checkInsByDate[todayISO] : undefined;

  if (signal === "im_stressed" || signal === "poor_sleep" || signal === "wired" || signal === "anxious") {
    return { focusBias: "downshift" };
  }

  if (signal === "im_exhausted") {
    return { focusBias: "stabilize", timeOverrideMin: 10 };
  }

  if (signal === "i_have_10_min") {
    return { timeOverrideMin: 10 };
  }

  if (signal === "i_have_more_energy") {
    const { stressState } = buildDayPlan({
      user,
      dateISO: todayISO,
      checkIn,
      checkInsByDate,
      weekContext: { busyDays: user.busyDays || [], recentNoveltyGroups: [] },
      overrides: null,
      qualityRules,
    });
    if (stressState.capacity >= 60 && stressState.loadBand !== "high") return { focusBias: "rebuild" };
    return { focusBias: "stabilize" };
  }

  return null;
}

function collectRecentNoveltyGroups(days, idx, windowDays) {
  if (!windowDays || windowDays <= 0) return [];
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
