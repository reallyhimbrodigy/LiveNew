CREATE TABLE IF NOT EXISTS user_state_history (
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, version)
);
