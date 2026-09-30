CREATE TABLE IF NOT EXISTS workspace_github_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  connected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  github_user_id bigint NOT NULL,
  github_login text NOT NULL,
  github_name text,
  github_email text,
  access_token text NOT NULL,
  scope text NOT NULL DEFAULT '',
  token_type text NOT NULL DEFAULT 'bearer',
  default_org text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_github_oauth_states (
  state text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  return_origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_github_oauth_states_workspace_user
  ON workspace_github_oauth_states(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_github_oauth_states_expires_at
  ON workspace_github_oauth_states(expires_at);
