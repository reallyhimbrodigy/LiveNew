CREATE TABLE IF NOT EXISTS day_state (
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  reset_id TEXT,
  movement_id TEXT,
  nutrition_id TEXT,
  last_quick_signal TEXT,
  last_input_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_day_state_date ON day_state(date_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_events_unique_rail_opened
  ON daily_events(user_id, date_iso, type)
  WHERE type = 'rail_opened';

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_events_unique_reset_completed
  ON daily_events(user_id, date_iso, type)
  WHERE type = 'reset_completed';
