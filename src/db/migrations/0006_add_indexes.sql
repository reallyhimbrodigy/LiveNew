CREATE INDEX IF NOT EXISTS idx_user_events_user_seq ON user_events(user_id, seq);
CREATE INDEX IF NOT EXISTS idx_decision_traces_user_date ON decision_traces(user_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_content_stats_user_item ON content_stats(user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);
