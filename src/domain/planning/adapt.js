import { addDaysISO } from "../utils/date.js";
import { buildDayPlan } from "./decision.js";

export function adaptPlan({
  weekPlan,
  user,
  todayISO,
  checkIn,
  signal,
  checkInsByDate,
  completionsByDate,
  feedback,
  overridesBase,
  qualityRules,
  weekContextBase,
  params,
  ruleConfig,
  library,
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
      completionsByDate,
      feedback,
      qualityRules: baseQualityRules,
      params,
      overridesBase,
      ruleConfig,
      library,
    });
    const mergedOverride = { ...(overridesBase || {}), ...(override || {}) };
    const res = rebuildDay({
      user,
      dateISO: todayISO,
      weekPlan: nextPlan,
      checkInsByDate,
      completionsByDate,
      feedback,
      overrides: mergedOverride,
      qualityRules: baseQualityRules,
      weekContextBase: baseContext,
      params,
      ruleConfig,
      library,
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
      completionsByDate,
      feedback,
      overrides: mergedOverride,
      qualityRules: baseQualityRules,
      weekContextBase: baseContext,
      params,
      ruleConfig,
      library,
    });
    if (res.changed) {
      nextPlan = res.weekPlan;
      changedDayISO = tomorrowISO;
      notes.push("Tomorrow downshifted due to high stress + poor sleep");
    }
  }

  return { weekPlan: nextPlan, changedDayISO, notes };
}

function rebuildDay({
  user,
  dateISO,
  weekPlan,
  checkInsByDate,
  completionsByDate,
  feedback,
  overrides,
  qualityRules,
  weekContextBase,
  params,
  ruleConfig,
  library,
}) {
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
    completionsByDate,
    feedback,
    weekContext,
    overrides,
    qualityRules,
    params,
    ruleConfig,
    library,
  });

  const nextDays = weekPlan.days.slice();
  const prev = nextDays[idx];
  const changed = JSON.stringify(prev) !== JSON.stringify(dayPlan);
  nextDays[idx] = dayPlan;

  return { weekPlan: { ...weekPlan, days: nextDays }, changed };
}

function buildOverrideFromSignal({
  signal,
  user,
  todayISO,
  checkInsByDate,
  completionsByDate,
  feedback,
  qualityRules,
  params,
  overridesBase,
  ruleConfig,
  library,
}) {
  const checkIn = checkInsByDate ? checkInsByDate[todayISO] : undefined;

  if (signal === "im_stressed" || signal === "poor_sleep" || signal === "wired" || signal === "anxious") {
    return { focusBias: "downshift", source: "signal" };
  }

  if (signal === "im_exhausted") {
    return { focusBias: "stabilize", timeOverrideMin: 10, source: "signal" };
  }

  if (signal === "i_have_10_min") {
    return { timeOverrideMin: 10, source: "signal" };
  }

  if (signal === "i_have_more_energy") {
    const { stressState } = buildDayPlan({
      user,
      dateISO: todayISO,
      checkIn,
      checkInsByDate,
      completionsByDate,
      feedback,
      weekContext: { busyDays: user.busyDays || [], recentNoveltyGroups: [] },
      overrides: overridesBase || null,
      qualityRules,
      params,
      ruleConfig,
      library,
    });
    if (stressState.capacity >= 60 && stressState.loadBand !== "high") return { focusBias: "rebuild", source: "signal" };
    return { focusBias: "stabilize", source: "signal" };
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
