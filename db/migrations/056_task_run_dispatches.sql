ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS task_scheduler_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS task_run_dispatches (
  run_id uuid PRIMARY KEY REFERENCES task_runs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  dispatch_class text NOT NULL CHECK (
    dispatch_class IN ('admin_interactive', 'interactive_followup', 'interactive_new', 'background')
  ),
  queue_state text NOT NULL DEFAULT 'pending' CHECK (
    queue_state IN ('pending', 'admitted', 'running', 'finished', 'cancelled')
  ),
  payload_json jsonb NOT NULL,
  eligible_at timestamptz NOT NULL DEFAULT now(),
  priority_actor_user_id uuid REFERENCES users(id),
  priority_actor_is_super_admin boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT now(),
  admitted_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_run_dispatches_pending_order
  ON task_run_dispatches(queue_state, eligible_at ASC, queued_at ASC, run_id ASC);

CREATE INDEX IF NOT EXISTS idx_task_run_dispatches_workspace_state
  ON task_run_dispatches(workspace_id, queue_state, queued_at ASC, run_id ASC);

CREATE INDEX IF NOT EXISTS idx_task_run_dispatches_environment_state
  ON task_run_dispatches(environment_id, queue_state, queued_at ASC, run_id ASC);
