CREATE TABLE IF NOT EXISTS task_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  parent_folder_id uuid REFERENCES task_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_folders_name_not_empty CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_task_folders_environment_parent_order
  ON task_folders(environment_id, parent_folder_id, sort_order, created_at, id);

CREATE INDEX IF NOT EXISTS idx_task_folders_workspace
  ON task_folders(workspace_id);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES task_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS folder_sort_order double precision NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_environment_folder_order
  ON tasks(environment_id, folder_id, folder_sort_order, created_at DESC, id);
