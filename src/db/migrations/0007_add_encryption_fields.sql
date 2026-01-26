ALTER TABLE users ADD COLUMN email_hash TEXT;
ALTER TABLE sessions ADD COLUMN token_hash TEXT;
ALTER TABLE auth_codes ADD COLUMN email_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email_hash ON auth_codes(email_hash);
