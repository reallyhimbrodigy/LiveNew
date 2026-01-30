DROP INDEX IF EXISTS idx_reset_completions_date;
DROP INDEX IF EXISTS idx_daily_events_type_date;
DROP INDEX IF EXISTS idx_daily_events_user_date;
DROP INDEX IF EXISTS idx_daily_checkins_date;

DROP TABLE IF EXISTS reset_completions;
DROP TABLE IF EXISTS daily_events;
DROP TABLE IF EXISTS daily_checkins;
DROP TABLE IF EXISTS users_profile;
