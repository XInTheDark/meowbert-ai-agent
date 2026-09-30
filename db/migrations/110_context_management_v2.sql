CREATE TABLE IF NOT EXISTS task_context_sessions (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  version text NOT NULL CHECK (version IN ('v1', 'v2')),
  first_model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_context_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_node_id uuid REFERENCES task_context_nodes(id) ON DELETE SET NULL,
  visible_message_id uuid REFERENCES task_messages(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('visible', 'private')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_context_nodes_visible_message
  ON task_context_nodes(task_id, visible_message_id)
  WHERE visible_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_context_nodes_parent
  ON task_context_nodes(task_id, parent_node_id);

CREATE TABLE IF NOT EXISTS task_context_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_window_id uuid REFERENCES task_context_windows(id) ON DELETE SET NULL,
  context_node_id uuid NOT NULL REFERENCES task_context_nodes(id) ON DELETE CASCADE,
  branch_leaf_message_id uuid REFERENCES task_messages(id) ON DELETE SET NULL,
  ordinal integer NOT NULL,
  opened_reason text NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_task_context_windows_task_open
  ON task_context_windows(task_id, created_at DESC)
  WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS task_context_history_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  window_id uuid NOT NULL REFERENCES task_context_windows(id) ON DELETE CASCADE,
  context_node_id uuid NOT NULL REFERENCES task_context_nodes(id) ON DELETE CASCADE,
  source_message_id uuid REFERENCES task_messages(id) ON DELETE SET NULL,
  ordinal integer NOT NULL,
  role text NOT NULL,
  item_type text,
  tool_namespace text,
  tool_name text,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_task_context_history_window_ordinal
  ON task_context_history_items(window_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_task_context_history_task_created
  ON task_context_history_items(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_context_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  context_node_id uuid NOT NULL REFERENCES task_context_nodes(id) ON DELETE CASCADE,
  path text NOT NULL,
  revision integer NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_context_notes_path_valid CHECK (path <> '' AND path !~ '(^|/)\\.?(\\.?)(/|$)'),
  CONSTRAINT task_context_notes_content_size CHECK (octet_length(content) <= 1000000),
  UNIQUE (task_id, context_node_id, path, revision)
);

CREATE INDEX IF NOT EXISTS idx_task_context_notes_task_updated
  ON task_context_notes(task_id, context_node_id, updated_at DESC);
