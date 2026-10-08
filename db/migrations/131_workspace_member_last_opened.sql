-- When each member last opened the workspace, so the workspace switcher can list workspaces by recency.
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;
