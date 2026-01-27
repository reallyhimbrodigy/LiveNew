import { weekStartMonday, addDaysISO } from "../utils/date.js";
import { buildDayPlan } from "./decision.js";

export function generateWeekPlan({
  user,
  weekAnchorISO,
  checkInsByDate,
  completionsByDate,
  feedback,
  qualityRules,
  params,
  ruleConfig,
  library,
  modelStamp,
  overridesBase,
}) {
  const startDateISO = weekStartMonday(weekAnchorISO);
  const days = [];
  const rules = {
    avoidNoveltyWindowDays: 2,
    constraintsEnabled: true,
    noveltyEnabled: true,
    ...(qualityRules || {}),
  };

  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(startDateISO, i);
    const checkIn = checkInsByDate ? checkInsByDate[dateISO] : undefined;
    const recentNoveltyGroups = collectRecentNoveltyGroups(days, rules.avoidNoveltyWindowDays);

    const { dayPlan } = buildDayPlan({
      user,
      dateISO,
      checkIn,
      checkInsByDate,
      completionsByDate,
      feedback,
      modelStamp,
      weekContext: { busyDays: user.busyDays || [], recentNoveltyGroups },
      overrides: overridesBase || null,
      qualityRules: rules,
      params,
      ruleConfig,
      library,
    });

    days.push(dayPlan);
  }

  return { startDateISO, days, version: 1 };
}

function collectRecentNoveltyGroups(days, windowDays) {
  if (!windowDays || windowDays <= 0) return [];
  const recent = days.slice(-windowDays);
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
