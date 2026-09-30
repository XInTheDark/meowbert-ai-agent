ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_default
  ON subscription_plans(is_default)
  WHERE is_default = true;

INSERT INTO subscription_plans (
  name,
  monthly_token_quota,
  usage_limits_json,
  notes,
  is_active,
  is_default,
  agent_ids_json
)
VALUES (
  '[All Users]',
  0,
  '[]'::jsonb,
  'Default plan applied to all users.',
  true,
  true,
  '[]'::jsonb
)
ON CONFLICT (name) DO UPDATE
  SET is_default = true,
      is_active = true;
