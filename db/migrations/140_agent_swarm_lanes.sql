-- Agent Swarm, second version: one leader that forks lanes. The previous swarm (workers, channels,
-- quota nodes, pauses) is removed without compatibility. Old leader tasks keep their conversation
-- and workflow_type; they have no task_swarms row, which marks them as legacy.

-- Hidden worker tasks of old swarms. Their directories stay on disk for the project cleanup plan.
DELETE FROM tasks
 WHERE workflow_type = 'agent_swarm'
   AND workflow_internal_role = 'worker';

DROP TABLE IF EXISTS task_workflow_swarm_quota_reservations;
DROP TABLE IF EXISTS task_workflow_swarm_quota_ledger;
DROP TABLE IF EXISTS task_workflow_swarm_node_members;
DROP TABLE IF EXISTS task_workflow_swarm_nodes;
DROP TABLE IF EXISTS task_workflow_swarm_pauses;
DROP TABLE IF EXISTS task_workflow_swarm_stalls;
DROP TABLE IF EXISTS task_workflow_messages;
DROP TABLE IF EXISTS task_workflow_channel_members;
DROP TABLE IF EXISTS task_workflow_channels;

DELETE FROM task_workflow_agents WHERE role IN ('leader', 'worker');
DELETE FROM task_workflow_submissions WHERE submission_type = 'swarm_output';
DELETE FROM task_workflows WHERE workflow_type = 'agent_swarm';

-- Inline checks were created without explicit names, so drop them by what they constrain.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.conrelid::regclass::text AS table_name, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND (
         (c.conrelid = 'task_workflows'::regclass AND pg_get_constraintdef(c.oid) LIKE '%workflow_type%')
         OR (c.conrelid = 'task_workflow_agents'::regclass AND pg_get_constraintdef(c.oid) LIKE '%role%')
       )
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', item.table_name, item.conname);
  END LOOP;
END
$$;

ALTER TABLE task_workflows
  ADD CONSTRAINT task_workflows_workflow_type_check
  CHECK (workflow_type IN ('long_horizon'));

ALTER TABLE task_workflow_agents
  ADD CONSTRAINT task_workflow_agents_role_check
  CHECK (role IN ('main', 'reviewer'));

-- 'leader' stays for legacy root tasks; 'worker' is carried forward and no code writes it.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_workflow_internal_role_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_workflow_internal_role_check
  CHECK (
    workflow_internal_role IS NULL
    OR workflow_internal_role IN ('reviewer', 'leader', 'worker', 'lane')
  );

-- 'agent_swarm_worker' stays allowed for existing rows; no code produces it.
ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_run_kind_check;
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
      'quality_control_reviewer',
      'agent_swarm_leader',
      'agent_swarm_worker',
      'agent_swarm_lane',
      'memory_synthesis'
    )
  );

-- One row per swarm, keyed by the leader's (root) task. config_json is the settings resolved at
-- creation; the task never re-reads its preset.
CREATE TABLE task_swarms (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  config_json jsonb NOT NULL,
  token_budget bigint CHECK (token_budget IS NULL OR token_budget > 0),
  reserve_tokens bigint NOT NULL DEFAULT 0 CHECK (reserve_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  deadline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The parent's exact request at a split, shared by every lane of that call.
CREATE TABLE task_swarm_fork_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  source_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  envelope_json jsonb NOT NULL,
  tools_json jsonb NOT NULL,
  items_json jsonb NOT NULL,
  capabilities_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_swarm_fork_seeds_swarm ON task_swarm_fork_seeds(swarm_task_id, created_at);

CREATE TABLE task_swarm_lanes (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  parent_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depth integer NOT NULL CHECK (depth >= 1 AND depth <= 3),
  kind text NOT NULL CHECK (kind IN ('split', 'diverge', 'check')),
  title text NOT NULL,
  direction text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'done', 'failed', 'stopped', 'expired')),
  model_route_json jsonb,
  fork_seed_id uuid REFERENCES task_swarm_fork_seeds(id) ON DELETE SET NULL,
  weight numeric NOT NULL DEFAULT 1 CHECK (weight > 0),
  share_tokens bigint CHECK (share_tokens IS NULL OR share_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  steps integer NOT NULL DEFAULT 0,
  wrap_up_notified boolean NOT NULL DEFAULT false,
  note_cursor bigint NOT NULL DEFAULT 0,
  result_json jsonb,
  merged_at timestamptz,
  check_findings integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_swarm_lanes_parent ON task_swarm_lanes(parent_task_id, status);
CREATE INDEX idx_task_swarm_lanes_swarm ON task_swarm_lanes(swarm_task_id, status, created_at);

CREATE TABLE task_swarm_notes (
  seq bigserial PRIMARY KEY,
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  author_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  scope_parent_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('shared', 'auto')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_swarm_notes_scope ON task_swarm_notes(scope_parent_task_id, seq);
CREATE INDEX idx_task_swarm_notes_swarm ON task_swarm_notes(swarm_task_id, seq);

-- A parent that is waiting on lanes: its run ended with exit reason swarm_wait and this row holds
-- the job that resumes it.
CREATE TABLE task_swarm_parks (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  resume_job_json jsonb NOT NULL,
  reason text NOT NULL CHECK (reason IN ('lanes', 'check', 'resume')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_swarm_parks_swarm ON task_swarm_parks(swarm_task_id);
