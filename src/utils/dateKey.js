import { toDateISOWithBoundary } from "../domain/utils/time.js";
import { addDaysISO } from "../domain/utils/date.js";

function normalizeNow(now) {
  if (!now) return null;
  if (now instanceof Date) return now;
  const parsed = new Date(now);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

export function getDateKey({ now, timezone, dayBoundaryHour }) {
  const resolvedNow = normalizeNow(now);
  if (!resolvedNow) return null;
  return toDateISOWithBoundary(resolvedNow, timezone, dayBoundaryHour);
}

export function getDateRangeKeys({ timezone, dayBoundaryHour, days, endNow }) {
  const count = Math.max(1, Math.min(Number(days) || 1, 90));
  const toKey = getDateKey({ now: endNow, timezone, dayBoundaryHour });
  if (!toKey) return { fromKey: null, toKey: null, keys: [] };
  const fromKey = addDaysISO(toKey, -(count - 1));
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(addDaysISO(fromKey, i));
  }
  return { fromKey, toKey, keys };
}

export function getDateRange({ now, timezone, dayBoundaryHour, days }) {
  const range = getDateRangeKeys({ timezone, dayBoundaryHour, days, endNow: now });
  return { startDateKey: range.fromKey, endDateKey: range.toKey, keys: range.keys };
}
