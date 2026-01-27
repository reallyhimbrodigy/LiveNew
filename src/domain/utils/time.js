import { addDaysISO } from "./date.js";

const DEFAULT_TZ = "UTC";

function safeTz(tz) {
  if (typeof tz !== "string" || !tz.trim()) return DEFAULT_TZ;
  const candidate = tz.trim();
  if (typeof Intl?.supportedValuesOf === "function") {
    try {
      if (!Intl.supportedValuesOf("timeZone").includes(candidate)) return DEFAULT_TZ;
    } catch {
      return DEFAULT_TZ;
    }
  }
  return candidate;
}

function safeBoundary(hour) {
  const n = Number(hour);
  if (!Number.isFinite(n)) return 4;
  const clamped = Math.max(0, Math.min(6, Math.floor(n)));
  return clamped;
}

function partsFor(date, tz) {
  const timeZone = safeTz(tz);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
  };
}

export function validateTimeZone(tz) {
  if (typeof tz !== "string") return false;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (typeof Intl?.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone").includes(trimmed);
    } catch {
      return false;
    }
  }
  return true;
}

export function nowInTz(tz) {
  const timeZone = safeTz(tz);
  const now = new Date();
  const parts = partsFor(now, timeZone);
  const dateISO = parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : now.toISOString().slice(0, 10);
  return {
    atISO: now.toISOString(),
    timeZone,
    dateISO,
    hour: Number(parts.hour ?? now.getUTCHours()),
  };
}

export function toDateISOWithBoundary(date, tz, dayBoundaryHour = 4) {
  const baseDate = date instanceof Date ? date : new Date(date || Date.now());
  if (!Number.isFinite(baseDate.getTime())) return null;
  const timeZone = safeTz(tz);
  const boundary = safeBoundary(dayBoundaryHour);
  const parts = partsFor(baseDate, timeZone);
  if (!parts.year || !parts.month || !parts.day) return baseDate.toISOString().slice(0, 10);
  let dateISO = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour ?? 0);
  if (hour < boundary) {
    dateISO = addDaysISO(dateISO, -1);
  }
  return dateISO;
}

export function parseDateISO(dateISO) {
  if (typeof dateISO !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const parsed = new Date(`${dateISO}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

