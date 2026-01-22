export function weekStartISO(dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}
