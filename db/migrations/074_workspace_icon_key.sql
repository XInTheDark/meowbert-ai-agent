ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS icon_key text NOT NULL DEFAULT 'folder-kanban';
