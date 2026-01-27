CREATE TABLE IF NOT EXISTS content_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by_admin TEXT NOT NULL,
  note TEXT NULL,
  library_hash TEXT NOT NULL,
  packs_hash TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  released_at TEXT NULL,
  rolled_back_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_snapshots_status ON content_snapshots(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_snapshots_created ON content_snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS content_snapshot_items (
  snapshot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, kind, item_id),
  FOREIGN KEY(snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_kind ON content_snapshot_items(snapshot_id, kind);

CREATE TABLE IF NOT EXISTS content_snapshot_packs (
  snapshot_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  pack_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, pack_id),
  FOREIGN KEY(snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_snapshot_params (
  snapshot_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY(snapshot_id, key),
  FOREIGN KEY(snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_snapshot_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_snapshot_pins (
  user_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL,
  pin_expires_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_snapshot_pins_snapshot ON user_snapshot_pins(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_user_snapshot_pins_expires ON user_snapshot_pins(pin_expires_at);

ALTER TABLE decision_traces ADD COLUMN model_stamp_json TEXT;
ALTER TABLE day_plan_history ADD COLUMN model_stamp_json TEXT;
