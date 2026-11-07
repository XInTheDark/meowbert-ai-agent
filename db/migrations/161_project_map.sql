-- The Project Map: task folders gain a note, projects gain a brief, and folders can hold note cards
-- for work nobody has started yet. Edits made by members are queued for the project's Master.

ALTER TABLE task_folders
  ADD COLUMN IF NOT EXISTS note_markdown text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS project_briefs (
  environment_id uuid PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
  markdown text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_map_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES task_folders(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'idea',
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_map_cards_title_not_empty CHECK (btrim(title) <> ''),
  CONSTRAINT project_map_cards_state_check CHECK (state IN ('idea', 'next', 'done'))
);

CREATE INDEX IF NOT EXISTS idx_project_map_cards_environment_folder_order
  ON project_map_cards(environment_id, folder_id, sort_order, created_at, id);

CREATE TABLE IF NOT EXISTS project_map_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_map_changes_environment_created
  ON project_map_changes(environment_id, created_at, id);
