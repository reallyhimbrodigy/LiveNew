CREATE TABLE IF NOT EXISTS consent_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO consent_meta (key, value) VALUES ('required_version', '1');

ALTER TABLE user_consents ADD COLUMN consent_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_user_consents_version ON user_consents(user_id, consent_version DESC);
