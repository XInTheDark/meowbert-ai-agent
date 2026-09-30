ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_archive_failed_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_task_history_archive_failed_attempts_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_task_history_archive_failed_attempts_check
  CHECK (task_history_archive_failed_attempts >= 0);

DROP INDEX IF EXISTS idx_tasks_task_history_archive_candidates;

CREATE INDEX IF NOT EXISTS idx_tasks_task_history_archive_candidates
  ON tasks(task_history_state, task_history_archive_failed_attempts, task_history_last_active_at ASC, id ASC)
  WHERE task_history_state = 'warm'
    AND task_history_archive_failed_attempts < 3;
