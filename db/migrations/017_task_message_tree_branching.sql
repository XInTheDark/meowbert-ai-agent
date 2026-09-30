ALTER TABLE task_messages
  ADD COLUMN IF NOT EXISTS parent_message_id uuid REFERENCES task_messages(id) ON DELETE CASCADE;

ALTER TABLE task_messages
  ADD COLUMN IF NOT EXISTS edited_from_message_id uuid REFERENCES task_messages(id) ON DELETE SET NULL;

WITH ordered AS (
  SELECT
    tm.id,
    LAG(tm.id) OVER (PARTITION BY tm.task_id ORDER BY tm.created_at ASC, tm.id ASC) AS parent_id
  FROM task_messages tm
),
updates AS (
  SELECT id, parent_id
  FROM ordered
  WHERE parent_id IS NOT NULL
)
UPDATE task_messages tm
   SET parent_message_id = updates.parent_id
  FROM updates
 WHERE tm.id = updates.id
   AND tm.parent_message_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_messages_task_parent_created
  ON task_messages(task_id, parent_message_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task_messages_task_edited_from
  ON task_messages(task_id, edited_from_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_messages_task_id_id
  ON task_messages(task_id, id);

CREATE TABLE IF NOT EXISTS task_branch_selections (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_leaf_message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id),
  CONSTRAINT task_branch_selections_active_leaf_fk
    FOREIGN KEY (task_id, active_leaf_message_id)
    REFERENCES task_messages(task_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_branch_selections_task_updated
  ON task_branch_selections(task_id, updated_at DESC);
