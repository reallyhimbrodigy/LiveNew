CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  replaced_by_id TEXT NULL,
  device_name TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS day_plan_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cause TEXT NOT NULL,
  day_contract_json TEXT NOT NULL,
  trace_ref TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_day_plan_history_user_date ON day_plan_history(user_id, date_iso);
CREATE INDEX IF NOT EXISTS idx_day_plan_history_user_created ON day_plan_history(user_id, created_at);
