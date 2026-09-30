ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS max_task_run_retries integer NOT NULL DEFAULT 5;

ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_max_task_run_retries_check;

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_max_task_run_retries_check
  CHECK (max_task_run_retries >= 0 AND max_task_run_retries <= 100);
