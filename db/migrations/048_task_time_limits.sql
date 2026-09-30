ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS time_limit_seconds integer,
  ADD COLUMN IF NOT EXISTS time_limit_deadline_at timestamptz;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_time_limit_seconds_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_time_limit_seconds_check
  CHECK (
    time_limit_seconds IS NULL
    OR (time_limit_seconds >= 60 AND time_limit_seconds <= 7 * 24 * 60 * 60)
  );

CREATE INDEX IF NOT EXISTS idx_tasks_time_limit_deadline_active
  ON tasks(time_limit_deadline_at)
  WHERE time_limit_deadline_at IS NOT NULL
    AND status IN ('queued', 'running', 'awaiting_input');
