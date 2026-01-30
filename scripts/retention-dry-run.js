import { initDb, closeDb, getDb } from "../src/state/db.js";

const RETENTION_DAYS = Math.max(1, Number(process.env.RETENTION_DAYS || process.env.EVENT_RETENTION_DAYS || 90));

async function run() {
  await initDb();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();

  const userEventsRow = db.prepare("SELECT COUNT(*) AS count FROM user_events WHERE created_at < ?").get(cutoff);
  const userEventsTotal = db.prepare("SELECT COUNT(*) AS count FROM user_events").get();
  const archiveTotal = db.prepare("SELECT COUNT(*) AS count FROM user_events_archive").get();

  const dailyEventsTotal = db.prepare("SELECT COUNT(*) AS count FROM daily_events").get();
  const weekStateTotal = db.prepare("SELECT COUNT(*) AS count FROM week_state").get();
  const dayStateTotal = db.prepare("SELECT COUNT(*) AS count FROM day_state").get();

  const report = {
    ok: true,
    retentionDays: RETENTION_DAYS,
    cutoff,
    wouldArchive: userEventsRow?.count ?? 0,
    totals: {
      user_events: userEventsTotal?.count ?? 0,
      user_events_archive: archiveTotal?.count ?? 0,
      daily_events: dailyEventsTotal?.count ?? 0,
      week_state: weekStateTotal?.count ?? 0,
      day_state: dayStateTotal?.count ?? 0,
    },
    safety: {
      deletes: ["user_events"],
      preserves: ["daily_events", "week_state", "day_state"],
    },
  };

  console.log(JSON.stringify(report, null, 2));
  await closeDb();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
