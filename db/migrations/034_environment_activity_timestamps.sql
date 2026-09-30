CREATE OR REPLACE FUNCTION sync_environment_updated_at_from_task()
RETURNS trigger AS $$
DECLARE
  target_environment_id uuid;
  activity_at timestamptz;
BEGIN
  target_environment_id := COALESCE(NEW.environment_id, OLD.environment_id);
  activity_at := COALESCE(NEW.updated_at, OLD.updated_at, now());

  UPDATE environments
     SET updated_at = GREATEST(updated_at, activity_at)
   WHERE id = target_environment_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_sync_environment_updated_at ON tasks;

CREATE TRIGGER tasks_sync_environment_updated_at
AFTER INSERT OR UPDATE OF updated_at, environment_id ON tasks
FOR EACH ROW
EXECUTE FUNCTION sync_environment_updated_at_from_task();

WITH task_activity AS (
  SELECT environment_id,
         MAX(updated_at) AS latest_task_updated_at
    FROM tasks
   GROUP BY environment_id
)
UPDATE environments e
   SET updated_at = GREATEST(e.updated_at, task_activity.latest_task_updated_at)
  FROM task_activity
 WHERE task_activity.environment_id = e.id;
