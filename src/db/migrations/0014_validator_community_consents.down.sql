DROP INDEX IF EXISTS idx_community_responses_user;
DROP INDEX IF EXISTS idx_community_responses_status;
DROP INDEX IF EXISTS idx_community_responses_reset_status;
DROP TABLE IF EXISTS community_responses;

DROP INDEX IF EXISTS idx_community_opt_in_updated;
DROP TABLE IF EXISTS community_opt_in;

DROP INDEX IF EXISTS idx_user_consents_user;
DROP TABLE IF EXISTS user_consents;

DROP INDEX IF EXISTS idx_validator_runs_at;
DROP INDEX IF EXISTS idx_validator_runs_kind_at;
DROP TABLE IF EXISTS validator_runs;
