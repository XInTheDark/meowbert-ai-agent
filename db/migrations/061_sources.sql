CREATE TABLE IF NOT EXISTS source_provider_settings (
  provider text PRIMARY KEY CHECK (provider IN ('google-drive', 'onedrive')),
  enabled boolean NOT NULL DEFAULT false,
  client_id text,
  client_secret text,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO source_provider_settings (provider, enabled)
VALUES ('google-drive', false), ('onedrive', false)
ON CONFLICT (provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_source_connections (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google-drive', 'onedrive')),
  tokens_json jsonb NOT NULL,
  account_id text,
  account_label text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_workspace_source_connections_workspace
  ON workspace_source_connections(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_source_oauth_states (
  state text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google-drive', 'onedrive')),
  code_verifier text NOT NULL,
  return_origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_source_oauth_states_workspace_user
  ON workspace_source_oauth_states(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_source_oauth_states_expires_at
  ON workspace_source_oauth_states(expires_at);
