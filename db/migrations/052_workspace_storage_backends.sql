ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS default_workspace_storage_backend_id text NOT NULL DEFAULT 'local-default';

UPDATE platform_settings
   SET default_workspace_storage_backend_id = 'local-default'
 WHERE COALESCE(btrim(default_workspace_storage_backend_id), '') = '';

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS storage_backend_id text NOT NULL DEFAULT 'local-default';

UPDATE workspaces
   SET storage_backend_id = 'local-default'
 WHERE COALESCE(btrim(storage_backend_id), '') = '';

CREATE TABLE IF NOT EXISTS workspace_storage_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_backend_id text NOT NULL,
  target_backend_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed', 'cancelled')) DEFAULT 'queued',
  request_source text NOT NULL CHECK (request_source IN ('manual', 'default_change_bulk')) DEFAULT 'manual',
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_storage_migrations_workspace_created
  ON workspace_storage_migrations(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_storage_migrations_status_created
  ON workspace_storage_migrations(status, created_at ASC);
