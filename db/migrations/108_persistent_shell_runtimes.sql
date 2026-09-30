ALTER TABLE users
  ADD COLUMN IF NOT EXISTS persistent_runtime_compute_credits integer;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS persistent_runtime_limit integer;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS persistent_runtime_compute_credits integer;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS persistent_runtime_limit integer;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_persistent_runtime_compute_credits_check;

ALTER TABLE users
  ADD CONSTRAINT users_persistent_runtime_compute_credits_check
  CHECK (persistent_runtime_compute_credits IS NULL OR persistent_runtime_compute_credits >= 0);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_persistent_runtime_limit_check;

ALTER TABLE users
  ADD CONSTRAINT users_persistent_runtime_limit_check
  CHECK (persistent_runtime_limit IS NULL OR persistent_runtime_limit >= 0);

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_persistent_runtime_compute_credits_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_persistent_runtime_compute_credits_check
  CHECK (persistent_runtime_compute_credits IS NULL OR persistent_runtime_compute_credits >= 0);

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_persistent_runtime_limit_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_persistent_runtime_limit_check
  CHECK (persistent_runtime_limit IS NULL OR persistent_runtime_limit >= 0);

CREATE TABLE IF NOT EXISTS persistent_shell_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command text NOT NULL,
  working_dir text NOT NULL,
  env_root text NOT NULL,
  workspace_root text NOT NULL,
  network_enabled boolean NOT NULL DEFAULT false,
  run_as_root boolean NOT NULL DEFAULT false,
  container_id text,
  process_id integer,
  log_path text NOT NULL,
  status text NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'running', 'idle', 'completed', 'stopped', 'failed')),
  started_at timestamptz,
  last_charged_at timestamptz,
  completed_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  recovery_count integer NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persistent_shell_sessions_creator_active
  ON persistent_shell_sessions(creator_user_id, status)
  WHERE status IN ('starting', 'running', 'idle');

CREATE INDEX IF NOT EXISTS idx_persistent_shell_sessions_environment_active
  ON persistent_shell_sessions(environment_id, status)
  WHERE status IN ('starting', 'running', 'idle');

CREATE TABLE IF NOT EXISTS user_persistent_runtime_compute_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES persistent_shell_sessions(id) ON DELETE CASCADE,
  credits integer NOT NULL CHECK (credits > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_persistent_runtime_compute_events_month
  ON user_persistent_runtime_compute_events(user_id, occurred_at);
