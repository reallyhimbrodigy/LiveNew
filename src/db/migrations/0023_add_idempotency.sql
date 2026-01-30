CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id TEXT NOT NULL,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, route, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_user_key ON idempotency_keys(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_daily_events_user_date_type ON daily_events(user_id, date_iso, type);
