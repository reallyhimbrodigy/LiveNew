CREATE TABLE IF NOT EXISTS ops_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  at_iso TEXT NOT NULL,
  ok INTEGER NOT NULL,
  report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_runs_kind_at ON ops_runs(kind, at_iso DESC);
CREATE INDEX IF NOT EXISTS idx_ops_runs_at ON ops_runs(at_iso DESC);

CREATE TABLE IF NOT EXISTS ops_log (
  id TEXT PRIMARY KEY,
  at_iso TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  props_json TEXT NOT NULL,
  FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ops_log_action ON ops_log(action, at_iso DESC);
CREATE INDEX IF NOT EXISTS idx_ops_log_at ON ops_log(at_iso DESC);

CREATE TABLE IF NOT EXISTS user_content_prefs (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  pref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, item_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_content_prefs_user ON user_content_prefs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_content_prefs_item ON user_content_prefs(item_id);

CREATE TABLE IF NOT EXISTS content_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  at_iso TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_feedback_item_reason ON content_feedback(item_id, reason_code);
CREATE INDEX IF NOT EXISTS idx_content_feedback_user_at ON content_feedback(user_id, at_iso DESC);
