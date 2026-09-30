CREATE TABLE IF NOT EXISTS usage_activation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  rules_json jsonb NOT NULL CHECK (jsonb_typeof(rules_json) = 'array'),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_finished_at timestamptz,
  last_status text CHECK (last_status IN ('running', 'succeeded', 'failed', 'skipped', 'interrupted')),
  last_error text,
  claim_token uuid,
  claim_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_activation_schedules_due
  ON usage_activation_schedules(next_run_at) WHERE enabled = true;
