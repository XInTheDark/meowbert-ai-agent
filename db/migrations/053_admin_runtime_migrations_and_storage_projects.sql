ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS storage_project_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_storage_project_id_unique
  ON workspaces(storage_project_id)
  WHERE storage_project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_runtime_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_key text NOT NULL,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed', 'cancelled')) DEFAULT 'queued',
  error_summary text,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_runtime_migrations_key_created
  ON admin_runtime_migrations(migration_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_runtime_migrations_status_created
  ON admin_runtime_migrations(status, created_at ASC);
