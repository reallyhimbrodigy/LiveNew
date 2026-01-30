CREATE TABLE IF NOT EXISTS users_profile (
  user_id TEXT PRIMARY KEY,
  timezone TEXT,
  day_boundary_hour INTEGER,
  constraints_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_checkins (
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  checkin_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, date_iso)
);

CREATE TABLE IF NOT EXISTS daily_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  type TEXT NOT NULL,
  at_iso TEXT NOT NULL,
  props_json TEXT
);

CREATE TABLE IF NOT EXISTS reset_completions (
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  reset_id TEXT NOT NULL,
  completed_at_iso TEXT NOT NULL,
  PRIMARY KEY(user_id, date_iso)
);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_date ON daily_checkins(date_iso);
CREATE INDEX IF NOT EXISTS idx_daily_events_user_date ON daily_events(user_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_daily_events_type_date ON daily_events(type, date_iso);
CREATE INDEX IF NOT EXISTS idx_reset_completions_date ON reset_completions(date_iso);
