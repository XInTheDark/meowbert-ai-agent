CREATE TABLE IF NOT EXISTS google_workspace_project_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  item_reference text NOT NULL,
  item_id text NOT NULL,
  resource_key text,
  name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN (
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation'
  )),
  web_url text,
  reference_token text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment_id, source_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_google_workspace_project_references_project
  ON google_workspace_project_references(workspace_id, environment_id);
