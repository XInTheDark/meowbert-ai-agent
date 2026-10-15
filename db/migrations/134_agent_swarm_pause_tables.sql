-- Agent Swarm pauses and the stall marker move out of task_workflows.state_json into their own rows,
-- so pausing or waking one agent no longer rewrites the whole workflow state.
CREATE TABLE IF NOT EXISTS task_workflow_swarm_pauses (
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  swarm_node_id text,
  since_message_no bigint NOT NULL DEFAULT 0 CHECK (since_message_no >= 0),
  status text NOT NULL,
  waiting_for_task_ids uuid[] NOT NULL DEFAULT '{}',
  finished_task_ids uuid[] NOT NULL DEFAULT '{}',
  trigger_source text NOT NULL,
  selection_user_id text,
  mode text NOT NULL CHECK (mode IN ('agent_swarm_leader', 'agent_swarm_worker')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_task_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_workflow_swarm_stalls (
  workflow_task_id uuid PRIMARY KEY REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  nudged_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  escalated boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO task_workflow_swarm_pauses (
  workflow_task_id, task_id, swarm_node_id, since_message_no, status,
  waiting_for_task_ids, finished_task_ids, trigger_source, selection_user_id, mode
)
SELECT w.task_id,
       t.id,
       NULLIF(pause.value->>'swarmNodeId', ''),
       CASE WHEN jsonb_typeof(pause.value->'sinceMessageNo') = 'number'
            THEN GREATEST(0, floor((pause.value->>'sinceMessageNo')::numeric))::bigint
            ELSE 0 END,
       COALESCE(NULLIF(pause.value->>'status', ''), 'Paused.'),
       ARRAY(
         SELECT entry::uuid
           FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(pause.value->'waitingForTaskIds') = 'array'
                                               THEN pause.value->'waitingForTaskIds' ELSE '[]'::jsonb END) AS entry
          WHERE entry ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ),
       ARRAY(
         SELECT entry::uuid
           FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(pause.value->'finishedTaskIds') = 'array'
                                               THEN pause.value->'finishedTaskIds' ELSE '[]'::jsonb END) AS entry
          WHERE entry ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ),
       pause.value->>'triggerSource',
       NULLIF(pause.value->>'selectionUserId', ''),
       pause.value->>'mode'
  FROM task_workflows w
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.state_json->'pausedSwarmAgents') = 'object'
                                     THEN w.state_json->'pausedSwarmAgents' ELSE '{}'::jsonb END) AS pause
  JOIN tasks t ON t.id::text = pause.key
 WHERE w.workflow_type = 'agent_swarm'
   AND jsonb_typeof(pause.value) = 'object'
   AND pause.value->>'triggerSource' IN ('web', 'telegram', 'discord', 'github', 'email')
   AND pause.value->>'mode' IN ('agent_swarm_leader', 'agent_swarm_worker')
ON CONFLICT (workflow_task_id, task_id) DO NOTHING;

INSERT INTO task_workflow_swarm_stalls (workflow_task_id, nudged_task_id, escalated)
SELECT w.task_id, t.id, COALESCE(w.state_json->'swarmStall'->'escalated' = 'true'::jsonb, false)
  FROM task_workflows w
  JOIN tasks t ON t.id::text = w.state_json->'swarmStall'->>'nudgedTaskId'
 WHERE w.workflow_type = 'agent_swarm'
   AND jsonb_typeof(w.state_json->'swarmStall') = 'object'
ON CONFLICT (workflow_task_id) DO NOTHING;

-- Drop the moved keys and the older wait/stall keys that every pause write used to strip.
UPDATE task_workflows
   SET state_json = state_json - ARRAY[
         'pausedSwarmAgents', 'swarmStall', 'pendingSwarmWaits',
         'lastSwarmStallSignature', 'lastSwarmWaitCycleSignature', 'lastSwarmWaitCycleTaskIds'
       ],
       updated_at = now()
 WHERE state_json ?| ARRAY[
         'pausedSwarmAgents', 'swarmStall', 'pendingSwarmWaits',
         'lastSwarmStallSignature', 'lastSwarmWaitCycleSignature', 'lastSwarmWaitCycleTaskIds'
       ];
