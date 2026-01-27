CREATE TABLE IF NOT EXISTS content_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_packs_updated_at ON content_packs(updated_at);

CREATE TABLE IF NOT EXISTS changelog (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL,
  audience TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changelog_created_at ON changelog(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_audience_created_at ON changelog(audience, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_attempts (
  email TEXT PRIMARY KEY,
  ip TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at TEXT,
  locked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_locked_until ON auth_attempts(locked_until);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  at_iso TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  props_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(at_iso DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit(admin_user_id, at_iso DESC);

CREATE TABLE IF NOT EXISTS debug_bundles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redacted_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debug_bundles_user ON debug_bundles(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debug_bundles_expires ON debug_bundles(expires_at);

