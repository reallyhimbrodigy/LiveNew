CREATE TABLE IF NOT EXISTS analytics_daily (
  date_iso TEXT PRIMARY KEY,
  checkins_count INTEGER NOT NULL DEFAULT 0,
  any_part_days_count INTEGER NOT NULL DEFAULT 0,
  feedback_not_relevant_count INTEGER NOT NULL DEFAULT 0,
  bad_day_mode_count INTEGER NOT NULL DEFAULT 0,
  active_users_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_active_users (
  date_iso TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY(date_iso, user_id)
);
