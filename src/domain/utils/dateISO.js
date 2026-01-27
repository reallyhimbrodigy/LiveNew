const DEFAULT_TZ = "UTC";

function resolveTimeZone(tz) {
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

function dateFromInput(isoOrDate) {
  if (isoOrDate instanceof Date) return isoOrDate;
  if (typeof isoOrDate === "string") return new Date(isoOrDate);
  return new Date();
}

export function toDateISOInTz(isoOrDate, tz) {
  const date = dateFromInput(isoOrDate);
  if (!Number.isFinite(date.getTime())) return null;
  const timeZone = resolveTimeZone(tz);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });
  if (!map.year || !map.month || !map.day) return null;
  return `${map.year}-${map.month}-${map.day}`;
}

export function nowDateISO(tz) {
  return toDateISOInTz(new Date(), tz) || new Date().toISOString().slice(0, 10);
}

export function validateDateISO(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

