import { addDaysISO } from "../domain/utils/date.js";

function latestCheckInForDate(checkIns, dateISO) {
  if (!Array.isArray(checkIns)) return null;
  let latest = null;
  checkIns.forEach((entry) => {
    if (entry?.dateISO !== dateISO) return;
    if (!latest) {
      latest = entry;
      return;
    }
    const prevAt = latest.atISO || "";
    const nextAt = entry.atISO || "";
    if (!prevAt || nextAt >= prevAt) latest = entry;
  });
  return latest;
}

function datesInRange(fromISO, toISO) {
  const dates = [];
  let cursor = fromISO;
  let guard = 0;
  while (cursor <= toISO && guard < 366) {
    dates.push(cursor);
    cursor = addDaysISO(cursor, 1);
    guard += 1;
  }
  return dates;
}

function buildAnchorMap(reminderIntents) {
  const map = new Map();
  (reminderIntents || []).forEach((intent) => {
    const dateISO = intent.dateISO;
    if (!dateISO) return;
    if (!map.has(dateISO)) {
      map.set(dateISO, { sunlight: false, meal: false, downshift: false });
    }
    if (intent.status !== "completed") return;
    const entry = map.get(dateISO);
    if (intent.intentKey === "sunlight_am") entry.sunlight = true;
    if (intent.intentKey === "meal_midday") entry.meal = true;
    if (intent.intentKey === "downshift_pm") entry.downshift = true;
  });
  return map;
}

export function buildOutcomes({ state, days, todayISO, reminderIntents, historyByDate, planChanges7d = 0, stabilityLimit = 8 }) {
  const rangeDays = Math.max(1, Math.min(Number(days) || 7, 30));
  const toISO = todayISO;
  const fromISO = addDaysISO(toISO, -(rangeDays - 1));
  const dates = datesInRange(fromISO, toISO);
  const checkIns = Array.isArray(state.checkIns) ? state.checkIns : [];
  const completions = state.partCompletionByDate || {};
  const anchorMap = buildAnchorMap(reminderIntents);

  const stressAvgTrend = [];
  const anchorsCompletedTrend = [];
  let daysAnyRegulationAction = 0;
  const resetCounts = new Map();

  dates.forEach((dateISO) => {
    const checkIn = latestCheckInForDate(checkIns, dateISO);
    stressAvgTrend.push({ dateISO, value: checkIn?.stress ?? null });

    const anchors = anchorMap.get(dateISO) || { sunlight: false, meal: false, downshift: false };
    anchorsCompletedTrend.push({ dateISO, sunlight: anchors.sunlight, meal: anchors.meal, downshift: anchors.downshift });

    const parts = completions[dateISO] || {};
    const anyPart = Boolean(parts.workout || parts.reset || parts.nutrition);
    if (anyPart) daysAnyRegulationAction += 1;

    if (parts.reset) {
      const day = historyByDate?.get(dateISO) || null;
      const reset = day?.what?.reset || null;
      if (reset?.id) {
        const existing = resetCounts.get(reset.id) || { resetId: reset.id, title: reset.title || reset.id, completedCount: 0, lastUsedAtISO: null };
        existing.completedCount += 1;
        existing.lastUsedAtISO = dateISO;
        resetCounts.set(reset.id, existing);
      }
    }
  });

  const topResets = Array.from(resetCounts.values())
    .sort((a, b) => b.completedCount - a.completedCount || String(a.resetId).localeCompare(String(b.resetId)))
    .slice(0, 5);

  const normalizedChanges = Number.isFinite(planChanges7d) ? planChanges7d : 0;
  const limit = Number.isFinite(stabilityLimit) && stabilityLimit > 0 ? stabilityLimit : 8;
  const stabilityScore = 1 - Math.min(1, normalizedChanges / (limit * 2));

  return {
    range: { days: rangeDays, fromISO, toISO },
    metrics: {
      daysAnyRegulationAction,
      stressAvgTrend,
      anchorsCompletedTrend,
      topResets,
      planChanges7d: normalizedChanges,
      stabilityScore,
    },
  };
}
