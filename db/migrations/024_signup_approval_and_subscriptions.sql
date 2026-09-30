ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS require_admin_signup_approval boolean NOT NULL DEFAULT false;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS default_free_message_limit integer DEFAULT NULL;

ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_default_free_message_limit_check;

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_default_free_message_limit_check
  CHECK (default_free_message_limit IS NULL OR default_free_message_limit >= 0);

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS token_weight_defaults_json jsonb NOT NULL DEFAULT '{"input":1,"output":2}'::jsonb;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS token_weight_overrides_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_approval_status text NOT NULL DEFAULT 'approved';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_signup_approval_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_signup_approval_status_check
  CHECK (signup_approval_status IN ('approved', 'pending', 'rejected'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE users
   SET signup_approval_status = CASE WHEN is_active THEN 'approved' ELSE 'rejected' END
 WHERE signup_approval_status NOT IN ('approved', 'pending', 'rejected')
    OR (signup_approval_status = 'approved' AND is_active = false);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS byo_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS byo_provider text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS byo_base_url text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS byo_api_key text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS byo_model text;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_byo_provider_check;

ALTER TABLE users
  ADD CONSTRAINT users_byo_provider_check
  CHECK (byo_provider IS NULL OR byo_provider = 'openai_compatible');

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_message_rate_limit_check;

ALTER TABLE users
  ADD CONSTRAINT users_message_rate_limit_check
  CHECK (message_rate_limit IS NULL OR message_rate_limit >= 0);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  monthly_token_quota bigint NOT NULL CHECK (monthly_token_quota >= 0),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_subscription_plans (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plan_id)
);

CREATE TABLE IF NOT EXISTS user_token_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  model text NOT NULL,
  provider_kind text NOT NULL CHECK (provider_kind IN ('platform', 'byo')),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  input_weight numeric(10, 4) NOT NULL CHECK (input_weight >= 0),
  output_weight numeric(10, 4) NOT NULL CHECK (output_weight >= 0),
  weighted_tokens bigint NOT NULL CHECK (weighted_tokens >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_free_message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  task_message_id uuid REFERENCES task_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscription_plans_plan_id
  ON user_subscription_plans(plan_id);

CREATE INDEX IF NOT EXISTS idx_user_token_usage_events_user_month
  ON user_token_usage_events(user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_user_free_message_events_user
  ON user_free_message_events(user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_free_message_events_message_id
  ON user_free_message_events(task_message_id)
  WHERE task_message_id IS NOT NULL;
