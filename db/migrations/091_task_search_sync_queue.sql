CREATE TABLE IF NOT EXISTS task_search_sync_queue (
  task_id uuid PRIMARY KEY,
  reason text NOT NULL DEFAULT 'changed',
  queued_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);

CREATE OR REPLACE FUNCTION enqueue_task_search_sync(target_task_id uuid, sync_reason text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_task_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO task_search_sync_queue (task_id, reason, queued_at, locked_at, last_error)
  VALUES (target_task_id, COALESCE(sync_reason, 'changed'), now(), NULL, NULL)
  ON CONFLICT (task_id) DO UPDATE
    SET reason = EXCLUDED.reason,
        queued_at = now(),
        locked_at = NULL,
        attempts = 0,
        last_error = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_task_search_sync_from_tasks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_task_search_sync(OLD.id, 'task_deleted');
    RETURN OLD;
  END IF;

  PERFORM enqueue_task_search_sync(NEW.id, 'task_changed');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_task_search_sync_from_task_messages()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_task_search_sync(OLD.task_id, 'message_changed');
    RETURN OLD;
  END IF;

  PERFORM enqueue_task_search_sync(NEW.task_id, 'message_changed');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_task_search_sync_from_task_schedules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_task_search_sync(OLD.task_id, 'schedule_changed');
    RETURN OLD;
  END IF;

  PERFORM enqueue_task_search_sync(NEW.task_id, 'schedule_changed');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_task_search_sync_for_folder_subtree(target_folder_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_folder_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO task_search_sync_queue (task_id, reason, queued_at, locked_at, last_error)
  WITH RECURSIVE folder_scope(id) AS (
      SELECT target_folder_id
      UNION ALL
      SELECT child.id
        FROM task_folders child
        JOIN folder_scope fs ON fs.id = child.parent_folder_id
    )
    SELECT t.id, 'folder_changed', now(), NULL, NULL
      FROM tasks t
     WHERE t.folder_id IN (SELECT id FROM folder_scope)
  ON CONFLICT (task_id) DO UPDATE
    SET reason = EXCLUDED.reason,
        queued_at = now(),
        locked_at = NULL,
        attempts = 0,
        last_error = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_task_search_sync_from_task_folders()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_task_search_sync_for_folder_subtree(OLD.id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_folder_id IS DISTINCT FROM OLD.parent_folder_id
     OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    PERFORM enqueue_task_search_sync_for_folder_subtree(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_search_sync_tasks ON tasks;
CREATE TRIGGER trg_task_search_sync_tasks
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION enqueue_task_search_sync_from_tasks();

DROP TRIGGER IF EXISTS trg_task_search_sync_task_messages ON task_messages;
CREATE TRIGGER trg_task_search_sync_task_messages
AFTER INSERT OR UPDATE OR DELETE ON task_messages
FOR EACH ROW EXECUTE FUNCTION enqueue_task_search_sync_from_task_messages();

DROP TRIGGER IF EXISTS trg_task_search_sync_task_schedules ON task_schedules;
CREATE TRIGGER trg_task_search_sync_task_schedules
AFTER INSERT OR UPDATE OR DELETE ON task_schedules
FOR EACH ROW EXECUTE FUNCTION enqueue_task_search_sync_from_task_schedules();

DROP TRIGGER IF EXISTS trg_task_search_sync_task_folders_before_delete ON task_folders;
CREATE TRIGGER trg_task_search_sync_task_folders_before_delete
BEFORE DELETE ON task_folders
FOR EACH ROW EXECUTE FUNCTION enqueue_task_search_sync_from_task_folders();

DROP TRIGGER IF EXISTS trg_task_search_sync_task_folders_after_change ON task_folders;
CREATE TRIGGER trg_task_search_sync_task_folders_after_change
AFTER INSERT OR UPDATE ON task_folders
FOR EACH ROW EXECUTE FUNCTION enqueue_task_search_sync_from_task_folders();

INSERT INTO task_search_sync_queue (task_id, reason, queued_at)
SELECT id, 'initial_index', now()
  FROM tasks
ON CONFLICT (task_id) DO NOTHING;
