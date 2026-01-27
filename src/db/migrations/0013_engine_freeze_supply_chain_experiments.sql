PRAGMA foreign_keys = OFF;

ALTER TABLE content_items ADD COLUMN status TEXT NOT NULL DEFAULT 'enabled';
ALTER TABLE content_items ADD COLUMN updated_by_admin TEXT NULL;

UPDATE content_items SET status = 'enabled' WHERE status IS NULL;

CREATE TABLE IF NOT EXISTS content_validation_reports (
  id TEXT PRIMARY KEY,
  at_iso TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  report_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  experiment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(experiment_id, user_id),
  FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO users (id, email, created_at)
SELECT DISTINCT sessions.user_id, NULL, COALESCE(sessions.created_at, datetime('now'))
FROM sessions
WHERE sessions.user_id IS NOT NULL;

INSERT OR IGNORE INTO users (id, email, created_at)
SELECT DISTINCT refresh_tokens.user_id, NULL, COALESCE(refresh_tokens.created_at, datetime('now'))
FROM refresh_tokens
WHERE refresh_tokens.user_id IS NOT NULL;

INSERT OR IGNORE INTO users (id, email, created_at)
SELECT DISTINCT content_stats.user_id, NULL, datetime('now')
FROM content_stats
WHERE content_stats.user_id IS NOT NULL;

ALTER TABLE sessions RENAME TO sessions_old;

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  token_hash TEXT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  device_name TEXT NULL,
  last_seen_at TEXT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO sessions (token, token_hash, user_id, expires_at, created_at, device_name, last_seen_at)
SELECT token, token_hash, user_id, expires_at, created_at, device_name, last_seen_at
FROM sessions_old;

DROP TABLE sessions_old;

ALTER TABLE refresh_tokens RENAME TO refresh_tokens_old;

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  replaced_by_id TEXT NULL,
  device_name TEXT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO refresh_tokens (id, user_id, token_hash, created_at, expires_at, revoked_at, replaced_by_id, device_name)
SELECT id, user_id, token_hash, created_at, expires_at, revoked_at, replaced_by_id, device_name
FROM refresh_tokens_old;

DROP TABLE refresh_tokens_old;

ALTER TABLE content_stats RENAME TO content_stats_old;

CREATE TABLE content_stats (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  picked INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  not_relevant INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, item_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO content_stats (user_id, item_id, picked, completed, not_relevant)
SELECT user_id, item_id, picked, completed, not_relevant
FROM content_stats_old;

DROP TABLE content_stats_old;

CREATE INDEX IF NOT EXISTS idx_content_items_status_kind ON content_items(status, kind);
CREATE INDEX IF NOT EXISTS idx_content_validation_reports_at ON content_validation_reports(at_iso);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiment_assignments_exp_user ON experiment_assignments(experiment_id, user_id);
CREATE INDEX IF NOT EXISTS idx_day_plan_history_user_date_created ON day_plan_history(user_id, date_iso, created_at);

CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_content_stats_user_item ON content_stats(user_id, item_id);

PRAGMA foreign_keys = ON;
