CREATE TABLE IF NOT EXISTS task_workflow_swarm_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  parent_node_id uuid REFERENCES task_workflow_swarm_nodes(id) ON DELETE CASCADE,
  node_type_id text,
  node_key text NOT NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  title text NOT NULL,
  depth integer NOT NULL CHECK (depth >= 1 AND depth <= 8),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  leader_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  allocated_tokens bigint NOT NULL DEFAULT 0 CHECK (allocated_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  system_reserve_tokens bigint NOT NULL DEFAULT 0 CHECK (system_reserve_tokens >= 0),
  unassigned_tokens bigint NOT NULL DEFAULT 0 CHECK (unassigned_tokens >= 0),
  debt_tokens bigint NOT NULL DEFAULT 0 CHECK (debt_tokens >= 0),
  deadline_at timestamptz,
  paused_reason text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by_workflow_agent_id uuid REFERENCES task_workflow_agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_task_id, parent_node_id, generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_workflow_swarm_nodes_key
  ON task_workflow_swarm_nodes(workflow_task_id, node_key);

CREATE INDEX IF NOT EXISTS idx_task_workflow_swarm_nodes_active
  ON task_workflow_swarm_nodes(workflow_task_id, status, depth);

CREATE INDEX IF NOT EXISTS idx_task_workflow_swarm_nodes_parent
  ON task_workflow_swarm_nodes(parent_node_id, status);

CREATE TABLE IF NOT EXISTS task_workflow_swarm_node_members (
  node_id uuid NOT NULL REFERENCES task_workflow_swarm_nodes(id) ON DELETE CASCADE,
  workflow_agent_id uuid NOT NULL REFERENCES task_workflow_agents(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('leader', 'worker')),
  slot_index integer NOT NULL CHECK (slot_index >= 0),
  lease_tokens bigint NOT NULL DEFAULT 0 CHECK (lease_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, workflow_agent_id),
  UNIQUE (node_id, role, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_swarm_node_members_agent
  ON task_workflow_swarm_node_members(workflow_agent_id, status);

CREATE TABLE IF NOT EXISTS task_workflow_swarm_quota_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES task_workflow_swarm_nodes(id) ON DELETE CASCADE,
  parent_node_id uuid REFERENCES task_workflow_swarm_nodes(id) ON DELETE CASCADE,
  workflow_agent_id uuid REFERENCES task_workflow_agents(id) ON DELETE SET NULL,
  run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('root_grant', 'child_grant', 'worker_lease', 'reservation', 'settlement', 'reclaim', 'recovery', 'adjustment')),
  amount_tokens bigint NOT NULL CHECK (amount_tokens <> 0),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_swarm_quota_ledger_node
  ON task_workflow_swarm_quota_ledger(node_id, created_at);

CREATE TABLE IF NOT EXISTS task_workflow_swarm_quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES task_workflow_swarm_nodes(id) ON DELETE CASCADE,
  workflow_agent_id uuid REFERENCES task_workflow_agents(id) ON DELETE SET NULL,
  run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  quota_generation integer NOT NULL CHECK (quota_generation >= 0),
  requested_tokens bigint NOT NULL CHECK (requested_tokens > 0),
  recovery boolean NOT NULL DEFAULT false,
  settled_tokens bigint CHECK (settled_tokens IS NULL OR settled_tokens >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'released', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_workflow_swarm_quota_reservations_run
  ON task_workflow_swarm_quota_reservations(run_id)
  WHERE run_id IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_task_workflow_swarm_quota_reservations_node
  ON task_workflow_swarm_quota_reservations(node_id, status);
