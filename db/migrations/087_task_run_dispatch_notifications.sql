CREATE OR REPLACE FUNCTION notify_task_run_dispatch_ready()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'task_run_dispatch_ready',
    json_build_object(
      'runId', NEW.run_id,
      'queueState', NEW.queue_state,
      'eligibleAt', NEW.eligible_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_run_dispatch_ready_insert_notify ON task_run_dispatches;
DROP TRIGGER IF EXISTS task_run_dispatch_ready_update_notify ON task_run_dispatches;
DROP TRIGGER IF EXISTS task_run_dispatch_ready_notify ON task_run_dispatches;

CREATE TRIGGER task_run_dispatch_ready_insert_notify
AFTER INSERT
ON task_run_dispatches
FOR EACH ROW
WHEN (NEW.queue_state IN ('pending', 'finished', 'cancelled'))
EXECUTE FUNCTION notify_task_run_dispatch_ready();

CREATE TRIGGER task_run_dispatch_ready_update_notify
AFTER UPDATE OF queue_state, eligible_at
ON task_run_dispatches
FOR EACH ROW
WHEN (
  NEW.queue_state IN ('pending', 'finished', 'cancelled')
  AND (OLD.queue_state IS DISTINCT FROM NEW.queue_state OR OLD.eligible_at IS DISTINCT FROM NEW.eligible_at)
)
EXECUTE FUNCTION notify_task_run_dispatch_ready();
