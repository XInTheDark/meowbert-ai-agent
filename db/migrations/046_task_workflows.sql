ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS workflow_type text,
  ADD COLUMN IF NOT EXISTS workflow_parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS workflow_internal_role text;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_workflow_type_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_workflow_type_check
  CHECK (workflow_type IS NULL OR workflow_type IN ('long_horizon', 'agent_swarm'));

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_workflow_internal_role_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_workflow_internal_role_check
  CHECK (
    workflow_internal_role IS NULL
    OR workflow_internal_role IN ('reviewer', 'leader', 'worker')
  );

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_type
  ON tasks(workflow_type)
  WHERE workflow_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_parent
  ON tasks(workflow_parent_task_id)
  WHERE workflow_parent_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_workflows (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  workflow_type text NOT NULL CHECK (workflow_type IN ('long_horizon', 'agent_swarm')),
  phase text NOT NULL,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_workflows_type_phase
  ON task_workflows(workflow_type, phase);

CREATE TABLE IF NOT EXISTS task_workflow_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('main', 'reviewer', 'leader', 'worker')),
  slot_index integer NOT NULL DEFAULT 0 CHECK (slot_index >= 0),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  last_inbox_refresh_message_no bigint NOT NULL DEFAULT 0,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_task_id, role, slot_index),
  UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_agents_workflow
  ON task_workflow_agents(workflow_task_id, role, slot_index);

CREATE TABLE IF NOT EXISTS task_workflow_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  workflow_agent_id uuid REFERENCES task_workflow_agents(id) ON DELETE SET NULL,
  submission_type text NOT NULL,
  round_no integer CHECK (round_no IS NULL OR round_no >= 0),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_submissions_workflow_type
  ON task_workflow_submissions(workflow_task_id, submission_type, round_no, created_at);

CREATE TABLE IF NOT EXISTS task_workflow_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('global', 'direct', 'group')),
  title text,
  created_by_workflow_agent_id uuid REFERENCES task_workflow_agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_channels_workflow
  ON task_workflow_channels(workflow_task_id, kind, created_at);

CREATE TABLE IF NOT EXISTS task_workflow_channel_members (
  channel_id uuid NOT NULL REFERENCES task_workflow_channels(id) ON DELETE CASCADE,
  workflow_agent_id uuid NOT NULL REFERENCES task_workflow_agents(id) ON DELETE CASCADE,
  last_seen_message_no bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, workflow_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_channel_members_agent
  ON task_workflow_channel_members(workflow_agent_id, channel_id);

CREATE TABLE IF NOT EXISTS task_workflow_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_task_id uuid NOT NULL REFERENCES task_workflows(task_id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES task_workflow_channels(id) ON DELETE CASCADE,
  sender_workflow_agent_id uuid REFERENCES task_workflow_agents(id) ON DELETE SET NULL,
  message_no bigserial NOT NULL,
  content_markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_task_id, message_no)
);

CREATE INDEX IF NOT EXISTS idx_task_workflow_messages_channel_no
  ON task_workflow_messages(channel_id, message_no);

CREATE INDEX IF NOT EXISTS idx_task_workflow_messages_workflow_no
  ON task_workflow_messages(workflow_task_id, message_no);
