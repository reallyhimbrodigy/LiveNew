DROP INDEX IF EXISTS idx_experiments_snapshot;
DROP INDEX IF EXISTS idx_validator_runs_snapshot;

-- Best-effort column drops (SQLite 3.35+)
ALTER TABLE experiments DROP COLUMN stopped_at;
ALTER TABLE experiments DROP COLUMN started_at;
ALTER TABLE experiments DROP COLUMN snapshot_id;

ALTER TABLE validator_runs DROP COLUMN snapshot_id;
