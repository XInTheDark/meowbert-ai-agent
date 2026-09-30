CREATE TABLE IF NOT EXISTS source_file_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  task_id uuid,
  provider text NOT NULL CHECK (provider IN ('onedrive')),
  source_id text NOT NULL,
  remote_item_id text NOT NULL,
  remote_name text NOT NULL,
  remote_mime_type text,
  remote_web_url text,
  local_relative_path text NOT NULL,
  sync_mode text NOT NULL DEFAULT 'manual' CHECK (sync_mode IN ('manual')),
  last_synced_remote_etag text,
  last_synced_remote_ctag text,
  last_synced_remote_modified_at timestamptz,
  last_synced_remote_size_bytes bigint,
  last_synced_local_hash text,
  last_synced_local_size_bytes bigint,
  last_synced_local_modified_at timestamptz,
  last_pulled_at timestamptz,
  last_pushed_at timestamptz,
  last_sync_error text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment_id, local_relative_path)
);

CREATE INDEX IF NOT EXISTS idx_source_file_links_workspace
  ON source_file_links(workspace_id);

CREATE INDEX IF NOT EXISTS idx_source_file_links_environment
  ON source_file_links(environment_id);

CREATE INDEX IF NOT EXISTS idx_source_file_links_task
  ON source_file_links(task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_file_links_remote_item
  ON source_file_links(provider, remote_item_id);
