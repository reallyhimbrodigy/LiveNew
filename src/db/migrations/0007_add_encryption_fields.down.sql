DROP INDEX IF EXISTS idx_users_email_hash;
DROP INDEX IF EXISTS idx_sessions_token_hash;
DROP INDEX IF EXISTS idx_auth_codes_email_hash;

ALTER TABLE users RENAME TO users_old;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NULL,
  created_at TEXT NOT NULL
);
INSERT INTO users (id, email, created_at)
  SELECT id, email, created_at FROM users_old;
DROP TABLE users_old;

ALTER TABLE sessions RENAME TO sessions_old;
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO sessions (token, user_id, expires_at, created_at)
  SELECT token, user_id, expires_at, created_at FROM sessions_old;
DROP TABLE sessions_old;

ALTER TABLE auth_codes RENAME TO auth_codes_old;
CREATE TABLE auth_codes (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
INSERT INTO auth_codes (email, code, user_id, expires_at)
  SELECT email, code, user_id, expires_at FROM auth_codes_old;
DROP TABLE auth_codes_old;
