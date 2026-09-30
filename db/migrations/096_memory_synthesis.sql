ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS specialized_models_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE task_runs
  DROP CONSTRAINT IF EXISTS task_runs_run_kind_check;

ALTER TABLE task_runs
  ADD CONSTRAINT task_runs_run_kind_check
  CHECK (
    run_kind IN (
      'default',
      'compact_only',
      'scheduled_auto',
      'infinite_auto',
      'infinite_checkin',
      'long_horizon_clarify',
      'long_horizon_main',
      'long_horizon_reviewer',
      'agent_swarm_leader',
      'agent_swarm_worker',
      'memory_synthesis'
    )
  );

CREATE TABLE IF NOT EXISTS memory_synthesis_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  initiator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')) DEFAULT 'queued',
  source_through_at timestamptz,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_synthesis_requests_one_active_per_project
  ON memory_synthesis_requests(environment_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS memory_synthesis_requests_project_history
  ON memory_synthesis_requests(environment_id, status, source_through_at DESC, created_at DESC);
