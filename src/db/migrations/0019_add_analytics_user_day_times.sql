CREATE TABLE IF NOT EXISTS analytics_user_day_times (
  date_iso TEXT NOT NULL,
  user_id TEXT NOT NULL,
  first_rail_opened_at TEXT NULL,
  first_reset_completed_at TEXT NULL,
  PRIMARY KEY(date_iso, user_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_user_day_times_date ON analytics_user_day_times(date_iso);
