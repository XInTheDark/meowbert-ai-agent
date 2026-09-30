CREATE TABLE IF NOT EXISTS workspace_github_apps (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  configured_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  app_id bigint NOT NULL,
  app_slug text NOT NULL,
  private_key_pem text NOT NULL,
  webhook_secret text NOT NULL,
  client_id text,
  client_secret text,
  default_org text,
  installation_id bigint UNIQUE,
  installation_account_login text,
  installation_account_type text CHECK (installation_account_type IN ('User', 'Organization')),
  installation_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_github_install_states (
  state text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  return_origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_github_install_states_workspace_user
  ON workspace_github_install_states(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_github_install_states_expires_at
  ON workspace_github_install_states(expires_at);

DROP TABLE IF EXISTS workspace_github_oauth_states;
DROP TABLE IF EXISTS workspace_github_connections;
