ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS subtask_depth int NOT NULL DEFAULT 0;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_root_path text;

UPDATE tasks
   SET task_root_path = '.meowbert/task-runs/' || id::text
 WHERE task_root_path IS NULL
    OR btrim(task_root_path) = '';

ALTER TABLE tasks
  ALTER COLUMN task_root_path SET NOT NULL;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_subtask_depth_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_subtask_depth_check
  CHECK (subtask_depth >= 0 AND subtask_depth <= 3);

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_parent_depth_consistency_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_parent_depth_consistency_check
  CHECK (
    (parent_task_id IS NULL AND subtask_depth = 0)
    OR (parent_task_id IS NOT NULL AND subtask_depth > 0)
  );

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_task_root_path_not_empty_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_task_root_path_not_empty_check
  CHECK (btrim(task_root_path) <> '');

CREATE INDEX IF NOT EXISTS idx_tasks_parent_task ON tasks(parent_task_id);
