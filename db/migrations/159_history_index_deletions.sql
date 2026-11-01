-- Tasks to drop from every worker's session history index. Each worker host keeps its own index on
-- local disk, so it applies these rows itself; rows are kept for 30 days.
CREATE TABLE IF NOT EXISTS history_index_deletions (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS history_index_deletions_created_at
  ON history_index_deletions (created_at);

CREATE OR REPLACE FUNCTION record_history_index_deletion() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  INSERT INTO history_index_deletions (task_id) VALUES (OLD.id);
  RETURN NULL;
END;
$body$;

DROP TRIGGER IF EXISTS history_index_task_deletion ON tasks;
CREATE TRIGGER history_index_task_deletion AFTER DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_history_index_deletion();

DROP TRIGGER IF EXISTS history_index_task_archive ON tasks;
CREATE TRIGGER history_index_task_archive AFTER UPDATE OF task_history_archived_at ON tasks
  FOR EACH ROW WHEN (OLD.task_history_archived_at IS NULL AND NEW.task_history_archived_at IS NOT NULL)
  EXECUTE FUNCTION record_history_index_deletion();

-- An archived task that ran on a device leaves its scratch and history files there; the device
-- removes both when it applies this tombstone, as it does when the task is deleted.
CREATE OR REPLACE FUNCTION record_device_task_archive() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  INSERT INTO device_file_tombstones (device_id, workspace_id, kind, target_id, relative_path)
    SELECT device.id, NEW.workspace_id, 'scratch', NEW.id, NEW.id::text
      FROM devices device
     WHERE device.id = (NEW.execution_target->>'deviceId')::uuid;
  RETURN NULL;
END;
$body$;

DROP TRIGGER IF EXISTS device_task_archive ON tasks;
CREATE TRIGGER device_task_archive AFTER UPDATE OF task_history_archived_at ON tasks
  FOR EACH ROW WHEN (
    OLD.task_history_archived_at IS NULL AND NEW.task_history_archived_at IS NOT NULL
    AND NEW.execution_target->>'kind' = 'local' AND NEW.execution_target ? 'deviceId'
  )
  EXECUTE FUNCTION record_device_task_archive();
