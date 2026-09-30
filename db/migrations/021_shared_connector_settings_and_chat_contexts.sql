CREATE TABLE IF NOT EXISTS shared_connector_settings (
  connector_type text PRIMARY KEY CHECK (connector_type IN ('telegram', 'discord')),
  enabled boolean NOT NULL DEFAULT false,
  bot_token text,
  bot_user_id text,
  telegram_ingest_mode text CHECK (telegram_ingest_mode IN ('webhook', 'polling')),
  telegram_last_update_id integer,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO shared_connector_settings (connector_type, enabled, telegram_ingest_mode)
VALUES
  ('telegram', false, 'webhook'),
  ('discord', false, NULL)
ON CONFLICT (connector_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS connector_chat_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_type text NOT NULL CHECK (connector_type IN ('telegram', 'discord')),
  external_chat_id text NOT NULL,
  external_thread_id text NOT NULL DEFAULT '',
  binding_id uuid NOT NULL REFERENCES connector_bindings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discord_access_mode text NOT NULL DEFAULT 'restricted' CHECK (discord_access_mode IN ('restricted', 'open')),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_chat_contexts_unique_chat
  ON connector_chat_contexts (connector_type, external_chat_id, external_thread_id);

CREATE INDEX IF NOT EXISTS idx_connector_chat_contexts_binding
  ON connector_chat_contexts (binding_id);

CREATE INDEX IF NOT EXISTS idx_connector_chat_contexts_workspace
  ON connector_chat_contexts (workspace_id);

CREATE TABLE IF NOT EXISTS connector_external_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL REFERENCES connector_bindings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (binding_id, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_external_grants_workspace_external
  ON connector_external_grants (workspace_id, external_user_id);
