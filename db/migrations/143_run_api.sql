-- Run API: leases with epochs, deduplicated operations, and model spend reservations.

-- Each claim of a run bumps its epoch; every Run API write carries the epoch it was claimed with,
-- and a write with an older epoch is refused. lease_api_url is the worker listener holding the
-- run's session, where the API forwards the run's calls.
ALTER TABLE task_run_dispatches
  ADD COLUMN IF NOT EXISTS lease_epoch integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_holder text,
  ADD COLUMN IF NOT EXISTS lease_api_url text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

-- A write is recorded before it runs and its response once it finishes, so a retry with the same
-- operation id gets the stored response instead of applying the write again. A row without a
-- response belongs to an attempt that never finished: its outcome is unknown.
CREATE TABLE IF NOT EXISTS run_api_operations (
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (run_id, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_run_api_operations_created_at
  ON run_api_operations(created_at);

-- The most a model request could cost, held against the user's allowance until the request settles.
CREATE TABLE IF NOT EXISTS user_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id uuid REFERENCES task_runs(id) ON DELETE CASCADE,
  weighted_tokens bigint NOT NULL CHECK (weighted_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_usage_reservations_user
  ON user_usage_reservations(user_id);
