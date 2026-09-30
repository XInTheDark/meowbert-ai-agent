ALTER TABLE persistent_shell_sessions
  ADD COLUMN IF NOT EXISTS created_by_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_persistent_shell_sessions_created_by_task
  ON persistent_shell_sessions(created_by_task_id, created_at);
