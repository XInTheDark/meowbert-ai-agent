ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS task_history_warm_retention_days integer NOT NULL DEFAULT 0;

ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_task_history_warm_retention_days_check;

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_task_history_warm_retention_days_check
  CHECK (task_history_warm_retention_days >= 0 AND task_history_warm_retention_days <= 3650);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_state text NOT NULL DEFAULT 'warm';

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_archive_key text;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_last_active_at timestamptz;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_last_warmed_at timestamptz;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_archived_at timestamptz;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_archive_started_at timestamptz;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_history_archive_error text;

UPDATE tasks
   SET task_history_last_active_at = COALESCE(
     task_history_last_active_at,
     completed_at,
     updated_at,
     created_at,
     now()
   )
 WHERE task_history_last_active_at IS NULL;

ALTER TABLE tasks
  ALTER COLUMN task_history_last_active_at SET NOT NULL;

ALTER TABLE tasks
  ALTER COLUMN task_history_last_active_at SET DEFAULT now();

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_task_history_state_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_task_history_state_check
  CHECK (task_history_state IN ('warm', 'archiving', 'archived'));

CREATE INDEX IF NOT EXISTS idx_tasks_task_history_archive_candidates
  ON tasks(task_history_state, task_history_last_active_at ASC, id ASC)
  WHERE task_history_state = 'warm';

CREATE INDEX IF NOT EXISTS idx_tasks_task_history_archive_started
  ON tasks(task_history_state, task_history_archive_started_at ASC, id ASC)
  WHERE task_history_state = 'archiving';
