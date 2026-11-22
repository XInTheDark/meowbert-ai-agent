-- Harness settings: task-level controls over what the harness does between runs.
-- Keep-alive is a Timed schedule (mode 'infinite' with run_deadline_at); these columns track who
-- set it and how the next cycle is timed.
ALTER TABLE task_schedules
  ADD COLUMN IF NOT EXISTS keep_alive_set_by text CHECK (keep_alive_set_by IN ('user', 'agent')),
  ADD COLUMN IF NOT EXISTS wake_interval_seconds integer CHECK (wake_interval_seconds BETWEEN 60 AND 86400),
  ADD COLUMN IF NOT EXISTS wake_interval_set_by text CHECK (wake_interval_set_by IN ('user', 'agent')),
  ADD COLUMN IF NOT EXISTS idle_cycle_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_cycle_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_wake_reason text CHECK (last_wake_reason IN ('interval', 'failure'));

CREATE TABLE IF NOT EXISTS task_harness_settings (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  stop_check_command text,
  stop_check_timeout_seconds integer CHECK (stop_check_timeout_seconds BETWEEN 10 AND 3600),
  stop_check_set_by text CHECK (stop_check_set_by IN ('user', 'agent')),
  token_budget bigint CHECK (token_budget > 0),
  token_budget_set_by text CHECK (token_budget_set_by IN ('user', 'agent')),
  notify text CHECK (notify IN ('on_finish', 'on_failure', 'never')),
  notify_set_by text CHECK (notify_set_by IN ('user', 'agent')),
  sandbox_keep_warm_minutes integer CHECK (sandbox_keep_warm_minutes > 0),
  sandbox_keep_warm_set_by text CHECK (sandbox_keep_warm_set_by IN ('user', 'agent')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tokens the task's runs have used, for its token budget.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS spent_tokens bigint NOT NULL DEFAULT 0;

-- Task sandboxes kept running after a run so the task's next run reuses them. The worker process
-- that parked one holds its handle; this row tells orphan cleanup to leave it until it expires.
CREATE TABLE IF NOT EXISTS task_warm_sandboxes (
  container_id text PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_warm_sandboxes_task ON task_warm_sandboxes(task_id);
CREATE INDEX IF NOT EXISTS idx_task_warm_sandboxes_user ON task_warm_sandboxes(user_id);
