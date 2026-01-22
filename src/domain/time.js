export function isTimeAfter(a, b) {
  const aMin = parseMinutes(a);
  const bMin = parseMinutes(b);
  if (aMin === null || bMin === null) return false;
  return aMin > bMin;
}

function parseMinutes(value) {
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}
