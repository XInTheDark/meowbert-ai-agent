CREATE TABLE IF NOT EXISTS project_canvases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  root_path text NOT NULL,
  entry_path text NOT NULL DEFAULT 'index.html',
  runtime_mode text NOT NULL DEFAULT 'static' CHECK (runtime_mode IN ('static', 'dev_server')),
  dev_server_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  last_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_canvases_name_not_empty CHECK (btrim(name) <> ''),
  CONSTRAINT project_canvases_slug_not_empty CHECK (btrim(slug) <> ''),
  CONSTRAINT project_canvases_root_path_not_empty CHECK (btrim(root_path) <> ''),
  CONSTRAINT project_canvases_entry_path_not_empty CHECK (btrim(entry_path) <> ''),
  UNIQUE (environment_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_project_canvases_workspace ON project_canvases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_project_canvases_environment_updated ON project_canvases(environment_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_canvases_last_task ON project_canvases(last_task_id);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS interactive_canvas_id uuid REFERENCES project_canvases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS interactive_canvas_intent text;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_interactive_canvas_intent_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_interactive_canvas_intent_check
  CHECK (
    interactive_canvas_intent IS NULL
    OR interactive_canvas_intent IN ('create', 'update', 'view')
  );

CREATE INDEX IF NOT EXISTS idx_tasks_interactive_canvas ON tasks(interactive_canvas_id);
