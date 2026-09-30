ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_source_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_source_check
    CHECK (source IN ('web', 'telegram', 'discord', 'github', 'email'));

ALTER TABLE connector_bindings
  DROP CONSTRAINT IF EXISTS connector_bindings_type_check;

ALTER TABLE connector_bindings
  ADD CONSTRAINT connector_bindings_type_check
    CHECK (type IN ('telegram', 'discord', 'github', 'email'));

CREATE TABLE IF NOT EXISTS email_inbound_settings (
  provider text PRIMARY KEY CHECK (provider IN ('brevo')),
  enabled boolean NOT NULL DEFAULT false,
  inbound_domain text,
  address_mode text NOT NULL DEFAULT 'random' CHECK (address_mode IN ('random', 'workspace_custom')),
  webhook_secret text,
  brevo_api_key text,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO email_inbound_settings (provider, enabled, address_mode)
VALUES ('brevo', false, 'random')
ON CONFLICT (provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_email_connectors (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL UNIQUE REFERENCES connector_bindings(id) ON DELETE CASCADE,
  local_part text NOT NULL,
  sender_policy text NOT NULL DEFAULT 'allow_any' CHECK (sender_policy IN ('allow_any', 'trusted_only')),
  trusted_senders text[] NOT NULL DEFAULT ARRAY[]::text[],
  default_environment_id uuid REFERENCES environments(id) ON DELETE SET NULL,
  prefix_enabled boolean NOT NULL DEFAULT true,
  keyword_enabled boolean NOT NULL DEFAULT true,
  llm_fallback_enabled boolean NOT NULL DEFAULT true,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_email_connectors_local_part
  ON workspace_email_connectors (lower(local_part));
