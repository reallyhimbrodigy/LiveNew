export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(dateISO, days) {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday as week start
export function weekStartMonday(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1 - day); // move to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
