ALTER TABLE workspace_storage_migrations
  ADD COLUMN IF NOT EXISTS worker_id text;

ALTER TABLE workspace_storage_migrations
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_workspace_storage_migrations_running_heartbeat
  ON workspace_storage_migrations(status, heartbeat_at ASC)
  WHERE status = 'running';
