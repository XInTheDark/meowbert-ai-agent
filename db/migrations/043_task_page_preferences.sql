ALTER TABLE users
  ADD COLUMN IF NOT EXISTS task_page_preferences_json jsonb NOT NULL DEFAULT '{}'::jsonb;
