CREATE TABLE IF NOT EXISTS week_state (
  user_id TEXT NOT NULL,
  week_start_date_key TEXT NOT NULL,
  timezone TEXT,
  day_boundary_hour INTEGER,
  lib_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, week_start_date_key)
);

CREATE TABLE IF NOT EXISTS week_days (
  user_id TEXT NOT NULL,
  week_start_date_key TEXT NOT NULL,
  date_key TEXT NOT NULL,
  reset_id TEXT,
  movement_id TEXT,
  nutrition_id TEXT,
  PRIMARY KEY(user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_week_state_user_week ON week_state(user_id, week_start_date_key);
CREATE INDEX IF NOT EXISTS idx_week_days_user_week ON week_days(user_id, week_start_date_key);
CREATE INDEX IF NOT EXISTS idx_week_days_user_date ON week_days(user_id, date_key);
