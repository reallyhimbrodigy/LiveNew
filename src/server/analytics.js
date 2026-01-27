import { addDaysISO } from "../domain/utils/date.js";
import {
  insertAnalyticsEvent,
  setAnalyticsDailyFlag,
  countAnalyticsDailyFlags,
  upsertAnalyticsDailyCounts,
  getFirstAnalyticsFlagDate,
} from "../state/db.js";

const FLAG_KEYS = {
  onboardCompleted: "onboard_completed",
  firstPlanGenerated: "first_plan_generated",
  firstCompletion: "first_completion",
  day3Retained: "day3_retained",
  anyRegulationCompleted: "any_regulation_completed",
};

const COUNTER_MAP = {
  onboard_completed: "onboard_completed_count",
  first_plan_generated: "first_plan_generated_count",
  first_completion: "first_completion_count",
  day3_retained: "day3_retained_count",
  any_regulation_completed: "days_with_any_regulation_action_completed",
};

export async function trackEvent(userId, eventKey, props = {}, atISO, dateISO) {
  if (!userId || !eventKey) return null;
  const now = atISO || new Date().toISOString();
  const date = dateISO || now.slice(0, 10);
  return insertAnalyticsEvent({
    userId,
    atISO: now,
    dateISO: date,
    eventKey,
    props,
  });
}

export async function setDailyFlag(dateISO, userId, flagKey) {
  if (!dateISO || !userId || !flagKey) return false;
  const inserted = await setAnalyticsDailyFlag(dateISO, userId, flagKey);
  if (inserted) {
    await recomputeDailyCounters(dateISO, [flagKey]);
  }
  return inserted;
}

export async function recomputeDailyCounters(dateISO, flagKeys = []) {
  const keys = flagKeys.length ? flagKeys : Object.values(FLAG_KEYS);
  const counts = {};
  for (const key of keys) {
    const count = await countAnalyticsDailyFlags(dateISO, key);
    const column = COUNTER_MAP[key];
    if (column) counts[column] = count;
  }
  if (Object.keys(counts).length) {
    await upsertAnalyticsDailyCounts(dateISO, counts);
  }
  return counts;
}

export async function ensureDay3Retention(userId, todayISO) {
  if (!userId || !todayISO) return false;
  const onboardDate = await getFirstAnalyticsFlagDate(userId, FLAG_KEYS.onboardCompleted);
  if (!onboardDate) return false;
  const target = addDaysISO(onboardDate, 2);
  if (todayISO !== target) return false;
  const inserted = await setDailyFlag(todayISO, userId, FLAG_KEYS.day3Retained);
  if (inserted) {
    await trackEvent(userId, FLAG_KEYS.day3Retained, { onboardDate }, new Date().toISOString(), todayISO);
  }
  return inserted;
}

export const AnalyticsFlags = FLAG_KEYS;

export async function getFirstFlagDate(userId, flagKey) {
  return getFirstAnalyticsFlagDate(userId, flagKey);
}
