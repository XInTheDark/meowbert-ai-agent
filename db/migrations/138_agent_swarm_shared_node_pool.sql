-- Agent Swarm members no longer hold per-agent leases: every member of a node draws each step
-- from the node's shared pool (unassigned_tokens). Return unused lease budget to its node's pool.
-- In-flight reservations stay counted in reserved_tokens and refund to the pool when they settle.
UPDATE task_workflow_swarm_nodes n
   SET unassigned_tokens = n.unassigned_tokens + unused.tokens,
       updated_at = now()
  FROM (
    SELECT node_id, SUM(GREATEST(0, lease_tokens - spent_tokens - reserved_tokens)) AS tokens
      FROM task_workflow_swarm_node_members
     WHERE status <> 'cancelled'
     GROUP BY node_id
  ) unused
 WHERE unused.node_id = n.id
   AND unused.tokens > 0;

ALTER TABLE task_workflow_swarm_node_members
  DROP COLUMN IF EXISTS lease_tokens;

-- Set once a member has been told its node's pool is running low; cleared when the node is refilled.
ALTER TABLE task_workflow_swarm_node_members
  ADD COLUMN IF NOT EXISTS low_budget_notified boolean NOT NULL DEFAULT false;
