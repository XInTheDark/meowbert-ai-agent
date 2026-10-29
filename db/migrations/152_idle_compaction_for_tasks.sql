-- Admins can extend idle compaction from Project Masters to every top-level task.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS idle_compaction_for_tasks boolean NOT NULL DEFAULT false;

-- Idle notifications now cover top-level tasks while that setting is on, on a channel named for both.
DROP TRIGGER IF EXISTS project_master_idle_run_ended_notify ON task_runs;
DROP TRIGGER IF EXISTS project_master_idle_settled_notify ON tasks;
DROP FUNCTION IF EXISTS notify_project_master_idle_run_ended();
DROP FUNCTION IF EXISTS notify_project_master_idle_settled();
DROP FUNCTION IF EXISTS notify_project_master_idle(uuid);

CREATE FUNCTION notify_task_idle(idle_task_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_masters WHERE task_id = idle_task_id)
     OR (
       EXISTS (SELECT 1 FROM platform_settings WHERE id = 1 AND idle_compaction_for_tasks)
       AND EXISTS (
         SELECT 1 FROM tasks t
          WHERE t.id = idle_task_id
            AND t.parent_task_id IS NULL
            AND t.workflow_parent_task_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM task_threads tt WHERE tt.task_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM task_swarm_lanes sl WHERE sl.task_id = t.id)
       )
     ) THEN
    PERFORM pg_notify('task_idle', idle_task_id::text);
  END IF;
END;
$$;

CREATE FUNCTION notify_task_idle_run_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_task_idle(NEW.task_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_idle_run_ended_notify AFTER UPDATE OF ended_at ON task_runs
  FOR EACH ROW WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
  EXECUTE FUNCTION notify_task_idle_run_ended();

CREATE FUNCTION notify_task_idle_settled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM notify_task_idle(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_idle_settled_notify AFTER UPDATE OF status ON tasks
  FOR EACH ROW WHEN (
    OLD.status IN ('queued', 'starting', 'running')
    AND NEW.status NOT IN ('queued', 'starting', 'running')
  )
  EXECUTE FUNCTION notify_task_idle_settled();

-- The idle compaction sweep looks for runs that ended recently.
CREATE INDEX IF NOT EXISTS idx_task_runs_ended_at ON task_runs(ended_at DESC) WHERE ended_at IS NOT NULL;
