CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO feature_flags (key, value, updated_at) VALUES
  ('rules.constraints.enabled', 'true', datetime('now')),
  ('rules.novelty.enabled', 'true', datetime('now')),
  ('rules.feedback.enabled', 'true', datetime('now')),
  ('rules.badDay.enabled', 'true', datetime('now')),
  ('rules.recoveryDebt.enabled', 'true', datetime('now')),
  ('rules.circadianAnchors.enabled', 'true', datetime('now'));
