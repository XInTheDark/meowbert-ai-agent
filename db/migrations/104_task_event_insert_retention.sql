CREATE OR REPLACE FUNCTION prune_task_events_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(
    (SELECT debug_mode
       FROM platform_settings
      WHERE id = 1),
    false
  ) THEN
    RETURN NEW;
  END IF;

  DELETE FROM task_events event
   WHERE event.id IN (
     SELECT overflow.id
       FROM task_events overflow
      WHERE overflow.task_id = NEW.task_id
      ORDER BY overflow.created_at DESC, overflow.id DESC
     OFFSET 20
      LIMIT 100
   );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prune_task_events_after_insert ON task_events;

CREATE TRIGGER trg_prune_task_events_after_insert
AFTER INSERT ON task_events
FOR EACH ROW
EXECUTE FUNCTION prune_task_events_after_insert();
