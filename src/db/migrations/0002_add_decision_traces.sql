CREATE TABLE IF NOT EXISTS decision_traces (
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL,
  inputs_json TEXT NOT NULL,
  stress_state_json TEXT NOT NULL,
  selected_json TEXT NOT NULL,
  applied_rules_json TEXT NOT NULL,
  rationale_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, date_iso)
);
