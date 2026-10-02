-- Per-task usage lookups and task deletion (ON DELETE SET NULL) both filter by task_id.
CREATE INDEX IF NOT EXISTS idx_user_token_usage_events_task_id
  ON user_token_usage_events(task_id)
  WHERE task_id IS NOT NULL;
