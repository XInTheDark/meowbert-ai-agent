-- Reports go back to the member who asked for the work, through the chat they last used,
-- and runs a member starts on a task themselves are no longer reported unless the Master
-- explicitly listens to that task. Workers learn about reports through notifications.

-- Where each member last wrote to the Master from. A NULL connector context means the web.
CREATE TABLE project_master_reply_contexts (
  master_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_context_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (master_task_id, user_id)
);

ALTER TABLE project_master_listeners
  ADD COLUMN requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN include_user_runs boolean NOT NULL DEFAULT false;

ALTER TABLE project_master_reports
  ADD COLUMN requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION record_project_master_report() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  listener project_master_listeners%ROWTYPE;
  latest_run_id uuid;
  latest_run_kind text;
  latest_sender text;
BEGIN
  IF NEW.status NOT IN ('succeeded', 'failed', 'cancelled', 'awaiting_input') OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT * INTO listener FROM project_master_listeners WHERE task_id = NEW.id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT id, run_kind INTO latest_run_id, latest_run_kind
    FROM task_runs WHERE task_id = NEW.id ORDER BY attempt_no DESC LIMIT 1;
  -- A run answering a message a member wrote themselves belongs to them, not the Master.
  -- Scheduled runs and runs answering the Master's own messages are always reported.
  IF NOT listener.include_user_runs
     AND COALESCE(latest_run_kind, 'default') NOT IN ('scheduled_auto', 'infinite_auto', 'infinite_checkin') THEN
    SELECT content_json->>'sender' INTO latest_sender
      FROM task_messages
     WHERE task_id = NEW.id AND role = 'user'
     ORDER BY created_at DESC, id DESC
     LIMIT 1;
    IF latest_sender IS DISTINCT FROM 'project_master' THEN
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO project_master_reports(master_task_id, task_id, run_id, status, requested_by_user_id, delivery_key)
    VALUES (listener.master_task_id, NEW.id, latest_run_id, NEW.status, listener.requested_by_user_id,
      'report:' || NEW.id || ':' || COALESCE(latest_run_id::text, NEW.updated_at::text) || ':' || NEW.status)
    ON CONFLICT (delivery_key) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Workers wake a Master when a report lands, or when a busy Master goes idle with reports waiting.
CREATE FUNCTION notify_project_master_wake(master_task_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM project_master_reports
     WHERE project_master_reports.master_task_id = notify_project_master_wake.master_task_id
       AND delivered_at IS NULL
  ) THEN
    PERFORM pg_notify('project_master_wake', master_task_id::text);
  END IF;
END;
$$;

CREATE FUNCTION notify_project_master_report_inserted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('project_master_wake', NEW.master_task_id::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_master_report_inserted_notify AFTER INSERT ON project_master_reports
  FOR EACH ROW EXECUTE FUNCTION notify_project_master_report_inserted();

CREATE FUNCTION notify_project_master_run_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_masters WHERE task_id = NEW.task_id) THEN
    PERFORM notify_project_master_wake(NEW.task_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_master_run_ended_notify AFTER UPDATE OF ended_at ON task_runs
  FOR EACH ROW WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
  EXECUTE FUNCTION notify_project_master_run_ended();

CREATE FUNCTION notify_project_master_settled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_masters WHERE task_id = NEW.id) THEN
    PERFORM notify_project_master_wake(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_master_settled_notify AFTER UPDATE OF status ON tasks
  FOR EACH ROW WHEN (
    OLD.status IN ('queued', 'starting', 'running')
    AND NEW.status NOT IN ('queued', 'starting', 'running')
  )
  EXECUTE FUNCTION notify_project_master_settled();
