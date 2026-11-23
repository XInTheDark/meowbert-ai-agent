CREATE TABLE IF NOT EXISTS antigravity_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  email text,
  tier_name text,
  tier_id text,
  oauth_token_encrypted text NOT NULL,
  acp_auth_state_encrypted text NOT NULL,
  token_expiry timestamptz,
  revision integer NOT NULL DEFAULT 1,
  is_selected boolean NOT NULL DEFAULT false,
  last_error text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS antigravity_credentials_one_selected_idx
  ON antigravity_credentials (is_selected)
  WHERE is_selected = true;
