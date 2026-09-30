CREATE TABLE IF NOT EXISTS connector_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL REFERENCES connector_bindings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  paired_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (binding_id, user_id),
  UNIQUE (binding_id, external_user_id)
);

CREATE TABLE IF NOT EXISTS connector_pair_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL REFERENCES connector_bindings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connector_pairings_binding_user
  ON connector_pairings(binding_id, user_id);

CREATE INDEX IF NOT EXISTS idx_connector_pairings_binding_external
  ON connector_pairings(binding_id, external_user_id);

CREATE INDEX IF NOT EXISTS idx_connector_pair_codes_binding_code
  ON connector_pair_codes(binding_id, code);

CREATE INDEX IF NOT EXISTS idx_connector_pair_codes_binding_user
  ON connector_pair_codes(binding_id, user_id);
