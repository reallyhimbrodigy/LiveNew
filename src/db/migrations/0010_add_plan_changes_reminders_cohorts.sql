CREATE TABLE IF NOT EXISTS plan_change_summaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cause TEXT NOT NULL,
  from_history_id TEXT NULL,
  to_history_id TEXT NULL,
  summary_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_change_user_date ON plan_change_summaries(user_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_plan_change_user_created ON plan_change_summaries(user_id, created_at);

CREATE TABLE IF NOT EXISTS reminder_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  intent_key TEXT NOT NULL,
  scheduled_for_iso TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date_iso, intent_key)
);

CREATE INDEX IF NOT EXISTS idx_reminder_user_date ON reminder_intents(user_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_reminder_status ON reminder_intents(status);

CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cohort_parameters (
  cohort_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(cohort_id, key)
);

CREATE TABLE IF NOT EXISTS user_cohorts (
  user_id TEXT PRIMARY KEY,
  cohort_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  overridden_by_admin INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_user_cohorts_cohort ON user_cohorts(cohort_id);
