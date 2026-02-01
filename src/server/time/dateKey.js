import { addDaysISO } from "../../domain/utils/date.js";

function normalizeNow(now) {
  if (!now) return null;
  if (now instanceof Date) return now;
  const parsed = new Date(now);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function normalizeBoundaryMinute(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 240;
  return Math.max(0, Math.min(1439, Math.floor(num)));
}

export function getDateKey({ now, timezone, dayBoundaryMinute }) {
  const resolvedNow = normalizeNow(now);
  if (!resolvedNow) return null;
  const timeZone = typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(resolvedNow);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });
  if (!map.year || !map.month || !map.day) return resolvedNow.toISOString().slice(0, 10);
  let dateISO = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour ?? 0);
  const minute = Number(map.minute ?? 0);
  const boundary = normalizeBoundaryMinute(dayBoundaryMinute);
  const minuteOfDay = hour * 60 + minute;
  if (Number.isFinite(minuteOfDay) && minuteOfDay < boundary) {
    dateISO = addDaysISO(dateISO, -1);
  }
  return dateISO;
}
