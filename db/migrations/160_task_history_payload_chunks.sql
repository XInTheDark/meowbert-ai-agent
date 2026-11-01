CREATE TABLE IF NOT EXISTS task_history_payloads (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload_id text NOT NULL,
  archive_key text NOT NULL,
  PRIMARY KEY (task_id, kind, payload_id)
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_history_archive_conversion_requested boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_archive_conversion_requested
  ON tasks(id) WHERE task_history_archive_conversion_requested AND task_history_state = 'archived';

-- Reads no longer change database residency. Only actual task activity controls this cutoff.
DROP INDEX IF EXISTS idx_tasks_task_history_archive_candidates;
CREATE INDEX IF NOT EXISTS idx_tasks_task_history_archive_candidates
  ON tasks(task_history_last_active_at, id)
  WHERE task_history_state = 'warm' AND task_history_archive_failed_attempts < 3
    AND status NOT IN ('queued', 'starting', 'running');

CREATE INDEX IF NOT EXISTS idx_task_context_closed_archive
  ON task_context_windows(closed_at, task_id, id) WHERE closed_at IS NOT NULL;

-- A restored task can be archived again; archived_at retains its previous timestamp.
DROP TRIGGER IF EXISTS history_index_task_archive ON tasks;
CREATE TRIGGER history_index_task_archive AFTER UPDATE OF task_history_state ON tasks
  FOR EACH ROW WHEN (OLD.task_history_state <> 'archived' AND NEW.task_history_state = 'archived')
  EXECUTE FUNCTION record_history_index_deletion();

DROP TRIGGER IF EXISTS device_task_archive ON tasks;
CREATE TRIGGER device_task_archive AFTER UPDATE OF task_history_state ON tasks
  FOR EACH ROW WHEN (
    OLD.task_history_state <> 'archived' AND NEW.task_history_state = 'archived'
    AND NEW.execution_target->>'kind' = 'local' AND NEW.execution_target ? 'deviceId'
  )
  EXECUTE FUNCTION record_device_task_archive();
