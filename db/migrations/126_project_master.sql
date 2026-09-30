-- One Master conversation per Project. The Master task itself is hidden from task lists.
CREATE TABLE project_masters (
  environment_id uuid PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tasks whose run outcomes are reported back to a Master.
CREATE TABLE project_master_listeners (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  master_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_master_listeners_master_idx ON project_master_listeners(master_task_id);

CREATE TABLE project_master_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id uuid,
  status text NOT NULL,
  delivery_key text UNIQUE NOT NULL,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_master_reports_inbox_idx ON project_master_reports(master_task_id, created_at, id)
  WHERE delivered_at IS NULL;

-- Record the report in the same transaction as the settled status, covering success,
-- failure, cancellation, and clarification paths alike.
CREATE FUNCTION record_project_master_report() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  listener_master_task_id uuid;
  latest_run_id uuid;
BEGIN
  IF NEW.status NOT IN ('succeeded', 'failed', 'cancelled', 'awaiting_input') OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT master_task_id INTO listener_master_task_id FROM project_master_listeners WHERE task_id = NEW.id;
  IF listener_master_task_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO latest_run_id FROM task_runs WHERE task_id = NEW.id ORDER BY attempt_no DESC LIMIT 1;
  INSERT INTO project_master_reports(master_task_id, task_id, run_id, status, delivery_key)
    VALUES (listener_master_task_id, NEW.id, latest_run_id, NEW.status,
      'report:' || NEW.id || ':' || COALESCE(latest_run_id::text, NEW.updated_at::text) || ':' || NEW.status)
    ON CONFLICT (delivery_key) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_master_report_status AFTER UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_project_master_report();
