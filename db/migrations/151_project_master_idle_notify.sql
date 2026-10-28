-- Workers check whether an idle Project Master should compact its context before the prompt cache expires.
-- A Master goes idle when its run ends and its status settles, which can land in either order.
CREATE FUNCTION notify_project_master_idle(master_task_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_masters WHERE task_id = notify_project_master_idle.master_task_id) THEN
    PERFORM pg_notify('project_master_idle', master_task_id::text);
  END IF;
END;
$$;

CREATE FUNCTION notify_project_master_idle_run_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_project_master_idle(NEW.task_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_master_idle_run_ended_notify AFTER UPDATE OF ended_at ON task_runs
  FOR EACH ROW WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
  EXECUTE FUNCTION notify_project_master_idle_run_ended();

CREATE FUNCTION notify_project_master_idle_settled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_project_master_idle(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_master_idle_settled_notify AFTER UPDATE OF status ON tasks
  FOR EACH ROW WHEN (
    OLD.status IN ('queued', 'starting', 'running')
    AND NEW.status NOT IN ('queued', 'starting', 'running')
  )
  EXECUTE FUNCTION notify_project_master_idle_settled();
