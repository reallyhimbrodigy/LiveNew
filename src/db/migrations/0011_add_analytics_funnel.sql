CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  at_iso TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  event_key TEXT NOT NULL,
  props_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_date ON analytics_events(user_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_analytics_events_key_date ON analytics_events(event_key, date_iso);

CREATE TABLE IF NOT EXISTS analytics_daily_user_flags (
  date_iso TEXT NOT NULL,
  user_id TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  PRIMARY KEY(date_iso, user_id, flag_key)
);
CREATE INDEX IF NOT EXISTS idx_analytics_flags_date_key ON analytics_daily_user_flags(date_iso, flag_key);
CREATE INDEX IF NOT EXISTS idx_analytics_flags_user_key ON analytics_daily_user_flags(user_id, flag_key);

ALTER TABLE analytics_daily ADD COLUMN onboard_completed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_daily ADD COLUMN first_plan_generated_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_daily ADD COLUMN first_completion_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_daily ADD COLUMN day3_retained_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_daily ADD COLUMN days_with_any_regulation_action_completed INTEGER NOT NULL DEFAULT 0;
