ALTER TABLE validator_runs ADD COLUMN snapshot_id TEXT;

CREATE INDEX IF NOT EXISTS idx_validator_runs_snapshot ON validator_runs(snapshot_id, at_iso DESC);

ALTER TABLE experiments ADD COLUMN snapshot_id TEXT NOT NULL DEFAULT '';
ALTER TABLE experiments ADD COLUMN started_at TEXT NULL;
ALTER TABLE experiments ADD COLUMN stopped_at TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_experiments_snapshot ON experiments(snapshot_id, status, updated_at DESC);
