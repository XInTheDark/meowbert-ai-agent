ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_incognito boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_incognito_cleanup
  ON tasks(environment_id, created_at ASC, id ASC)
  WHERE is_incognito = true;
