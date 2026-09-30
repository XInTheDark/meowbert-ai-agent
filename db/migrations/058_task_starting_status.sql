ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('queued', 'starting', 'running', 'awaiting_input', 'succeeded', 'failed', 'cancelled'));

DROP INDEX IF EXISTS idx_tasks_time_limit_deadline_active;

CREATE INDEX IF NOT EXISTS idx_tasks_time_limit_deadline_active
  ON tasks(time_limit_deadline_at)
  WHERE time_limit_deadline_at IS NOT NULL
    AND status IN ('queued', 'starting', 'running', 'awaiting_input');
