DROP INDEX IF EXISTS idx_content_items_status_kind;
DROP INDEX IF EXISTS idx_content_validation_reports_at;
DROP INDEX IF EXISTS idx_experiments_status;
DROP INDEX IF EXISTS idx_experiment_assignments_exp_user;
DROP INDEX IF EXISTS idx_day_plan_history_user_date_created;

DROP TABLE IF EXISTS experiment_assignments;
DROP TABLE IF EXISTS experiments;
DROP TABLE IF EXISTS content_validation_reports;
