ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS max_steps_override integer;

ALTER TABLE task_schedules
  ADD COLUMN IF NOT EXISTS run_timeout_seconds integer,
  ADD COLUMN IF NOT EXISTS run_deadline_at timestamptz;
