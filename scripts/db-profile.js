import { initDb, closeDb, explainQueryPlan, checkRequiredIndexes } from "../src/state/db.js";

const SAMPLE_USER = "profile_user";
const SAMPLE_DATE = "2026-01-30";
const SAMPLE_WEEK = "2026-01-27";
const SAMPLE_RANGE_START = "2026-01-24";
const SAMPLE_RANGE_END = "2026-01-30";

function usesIndex(plan) {
  return plan.some((row) => {
    const detail = String(row.detail || row[3] || "").toUpperCase();
    return detail.includes("USING INDEX") || detail.includes("USING COVERING INDEX");
  });
}

function hasFullScan(plan) {
  return plan.some((row) => {
    const detail = String(row.detail || row[3] || "").toUpperCase();
    if (!detail.includes("SCAN")) return false;
    return !detail.includes("USING INDEX") && !detail.includes("USING COVERING INDEX");
  });
}

async function explain(label, sql) {
  const plan = await explainQueryPlan(sql);
  const indexed = usesIndex(plan);
  const fullScan = hasFullScan(plan);
  return { label, sql, indexed, fullScan, plan };
}

async function run() {
  await initDb();
  const indexCheck = await checkRequiredIndexes();

  const queries = [
    {
      label: "daily_events_range",
      sql: `SELECT id, user_id, date_iso, type, at_iso, props_json FROM daily_events WHERE user_id = '${SAMPLE_USER}' AND date_iso >= '${SAMPLE_RANGE_START}' AND date_iso <= '${SAMPLE_RANGE_END}' ORDER BY at_iso ASC`,
    },
    {
      label: "daily_events_by_type",
      sql: `SELECT id, user_id, date_iso, type, at_iso, props_json FROM daily_events WHERE user_id = '${SAMPLE_USER}' AND date_iso = '${SAMPLE_DATE}' AND type = 'reset_completed' ORDER BY at_iso ASC LIMIT 1`,
    },
    {
      label: "week_state_lookup",
      sql: `SELECT user_id, week_start_date_key, timezone, day_boundary_hour, lib_version, created_at, updated_at FROM week_state WHERE user_id = '${SAMPLE_USER}' AND week_start_date_key = '${SAMPLE_WEEK}'`,
    },
    {
      label: "week_days_lookup",
      sql: `SELECT user_id, week_start_date_key, date_key, reset_id, movement_id, nutrition_id FROM week_days WHERE user_id = '${SAMPLE_USER}' AND date_key = '${SAMPLE_DATE}'`,
    },
    {
      label: "day_state_lookup",
      sql: `SELECT user_id, date_key, reset_id, movement_id, nutrition_id, last_quick_signal, last_input_hash, created_at, updated_at FROM day_state WHERE user_id = '${SAMPLE_USER}' AND date_key = '${SAMPLE_DATE}'`,
    },
  ];

  const suggestions = {
    daily_events_range: ["idx_daily_events_user_date"],
    daily_events_by_type: ["idx_daily_events_user_date_type"],
    week_state_lookup: ["idx_week_state_user_week"],
    week_days_lookup: ["idx_week_days_user_date"],
    day_state_lookup: ["idx_day_state_user_date"],
  };

  const plans = [];
  for (const entry of queries) {
    plans.push(await explain(entry.label, entry.sql));
  }

  const missingIndexes = indexCheck.missing || [];
  const queryIssues = plans.filter((plan) => !plan.indexed).map((plan) => plan.label);
  const fullScans = plans.filter((plan) => plan.fullScan).map((plan) => plan.label);
  const ok = indexCheck.ok && queryIssues.length === 0 && fullScans.length === 0;

  console.log(
    JSON.stringify(
      {
        ok,
        indexes: { ok: indexCheck.ok, missing: missingIndexes },
        queries: plans.map((plan) => ({
          label: plan.label,
          indexed: plan.indexed,
          fullScan: plan.fullScan,
          suggestions: suggestions[plan.label] || [],
        })),
        queryIssues,
        fullScans,
      },
      null,
      2
    )
  );

  await closeDb();
  if (!ok) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
