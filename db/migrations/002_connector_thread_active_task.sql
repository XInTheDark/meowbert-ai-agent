ALTER TABLE connector_threads
  ADD COLUMN IF NOT EXISTS active_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_connector_threads_active_task ON connector_threads(active_task_id);
