CREATE TABLE IF NOT EXISTS validator_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  at_iso TEXT NOT NULL,
  ok INTEGER NOT NULL,
  report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validator_runs_kind_at ON validator_runs(kind, at_iso DESC);
CREATE INDEX IF NOT EXISTS idx_validator_runs_at ON validator_runs(at_iso DESC);

CREATE TABLE IF NOT EXISTS user_consents (
  user_id TEXT NOT NULL,
  consent_key TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY(user_id, consent_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON user_consents(user_id);

CREATE TABLE IF NOT EXISTS community_opt_in (
  user_id TEXT PRIMARY KEY,
  opted_in INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_community_opt_in_updated ON community_opt_in(updated_at DESC);

CREATE TABLE IF NOT EXISTS community_responses (
  id TEXT PRIMARY KEY,
  reset_item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  moderated_by TEXT NULL,
  moderated_at TEXT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_community_responses_reset_status ON community_responses(reset_item_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_responses_status ON community_responses(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_responses_user ON community_responses(user_id, created_at DESC);
