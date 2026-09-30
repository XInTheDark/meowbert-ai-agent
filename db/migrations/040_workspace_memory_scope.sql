ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS root_path text NOT NULL DEFAULT '';

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS memory_enabled boolean NOT NULL DEFAULT false;
