const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateISO(value) {
  return typeof value === "string" && DATE_RE.test(value);
}

export function toDateISOInTz(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch {
    return null;
  }
}

export function nowDateISO(timeZone) {
  return toDateISOInTz(new Date(), timeZone) || new Date().toISOString().slice(0, 10);
}
