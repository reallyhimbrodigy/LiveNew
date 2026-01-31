// Runbook: set FUNNEL_DAYS and FUNNEL_MIN_HOURS to scan drop-offs; uses local DB.
import { initDb, closeDb, getDb } from "../src/state/db.js";

const FUNNEL_DAYS = Math.max(1, Number(process.env.FUNNEL_DAYS || 7));
const FUNNEL_MIN_HOURS = Math.max(1, Number(process.env.FUNNEL_MIN_HOURS || 12));

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hoursBetween(aISO, bISO) {
  const a = Date.parse(aISO);
  const b = Date.parse(bISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / (1000 * 60 * 60);
}

async function run() {
  await initDb();
  const todayISO = new Date().toISOString().slice(0, 10);
  const fromISO = addDaysISO(todayISO, -FUNNEL_DAYS + 1);

  const rows = getDb()
    .prepare(
      `SELECT date_iso AS dateISO, user_id AS userId, first_rail_opened_at AS firstRailOpenedAt, first_reset_completed_at AS firstResetCompletedAt
       FROM analytics_user_day_times
       WHERE date_iso >= ? AND date_iso <= ? AND first_rail_opened_at IS NOT NULL`
    )
    .all(fromISO, todayISO);

  const nowISO = new Date().toISOString();
  const anomalies = [];
  rows.forEach((row) => {
    if (!row.firstRailOpenedAt) return;
    if (row.firstResetCompletedAt) return;
    const elapsed = hoursBetween(row.firstRailOpenedAt, nowISO);
    if (elapsed == null || elapsed < FUNNEL_MIN_HOURS) return;
    const entry = {
      event: "funnel_dropoff",
      dateISO: row.dateISO,
      userId: row.userId,
      firstRailOpenedAt: row.firstRailOpenedAt,
      elapsedHours: Math.round(elapsed * 10) / 10,
    };
    anomalies.push(entry);
    console.log(JSON.stringify(entry));
  });

  await closeDb();
  console.log(
    JSON.stringify({
      ok: true,
      fromISO,
      toISO: todayISO,
      minHours: FUNNEL_MIN_HOURS,
      dropoffCount: anomalies.length,
    })
  );
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
