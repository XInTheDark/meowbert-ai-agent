-- Agent Swarm: messages a parent sends to one of its lanes (steer, resume, stop). They are claimed at
-- the lane's next step boundary and appended to the end of its conversation, never to its prefix.
CREATE TABLE task_swarm_lane_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('steer', 'resume', 'stop')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX idx_task_swarm_lane_inbox_pending ON task_swarm_lane_inbox(lane_task_id, created_at) WHERE delivered_at IS NULL;
