CREATE TABLE IF NOT EXISTS email_provider_settings (
  provider text PRIMARY KEY CHECK (provider IN ('listmonk')),
  enabled boolean NOT NULL DEFAULT false,
  base_url text,
  api_username text,
  api_token text,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO email_provider_settings (provider, enabled)
VALUES ('listmonk', false)
ON CONFLICT (provider) DO NOTHING;
