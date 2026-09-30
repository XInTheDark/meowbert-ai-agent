ALTER TABLE email_inbound_settings
  ADD COLUMN IF NOT EXISTS debug_logging_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS email_inbound_debug_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('brevo')),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  binding_id uuid REFERENCES connector_bindings(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message text NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_inbound_debug_events_created_at
  ON email_inbound_debug_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_inbound_debug_events_workspace_id
  ON email_inbound_debug_events (workspace_id, created_at DESC);
