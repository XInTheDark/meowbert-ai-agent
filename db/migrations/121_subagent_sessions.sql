CREATE TABLE task_subagent_sessions (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  root_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  spawn_key text UNIQUE NOT NULL,
  model_tier text NOT NULL CHECK (model_tier IN ('default', 'fast')),
  runtime_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_subagent_sessions_root_idx ON task_subagent_sessions(root_task_id);

CREATE TABLE task_subagent_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sender_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('message', 'assignment', 'result', 'timeout')),
  body text NOT NULL,
  delivery_key text UNIQUE NOT NULL,
  wake boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_subagent_mail_inbox_idx ON task_subagent_mail(recipient_task_id, created_at, id)
  WHERE delivered_at IS NULL;

CREATE TABLE task_subagent_waits (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  resume_job_json jsonb NOT NULL,
  deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Record the result in the same transaction as the terminal status, including failure
-- and cancellation paths that do not pass through the successful-run finalizer.
CREATE FUNCTION record_subagent_terminal_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  latest_run_id uuid;
  result_text text;
BEGIN
  IF NEW.status NOT IN ('succeeded', 'failed', 'cancelled') OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  DELETE FROM task_subagent_waits WHERE task_id = NEW.id;
  IF EXISTS (SELECT 1 FROM task_subagent_sessions WHERE task_id = NEW.id) THEN
    SELECT id INTO latest_run_id FROM task_runs WHERE task_id = NEW.id ORDER BY attempt_no DESC LIMIT 1;
    SELECT content_json->>'text' INTO result_text FROM task_messages
      WHERE task_id = NEW.id AND role = 'assistant' AND COALESCE(content_json->>'text', '') <> ''
      ORDER BY created_at DESC, id DESC LIMIT 1;
    INSERT INTO task_subagent_mail(recipient_task_id, sender_task_id, kind, body, delivery_key)
      VALUES (NEW.parent_task_id, NEW.id, 'result',
        NEW.status || CASE WHEN NEW.status = 'cancelled' THEN '' ELSE E'\n' || COALESCE(result_text, '') END,
        'result:' || NEW.id || ':' || COALESCE(latest_run_id::text, NEW.updated_at::text))
      ON CONFLICT (delivery_key) DO NOTHING;
  END IF;
  UPDATE tasks SET cancellation_requested = true, resume_after_interrupt = false,
    status = CASE WHEN status IN ('starting', 'running') THEN status ELSE 'cancelled' END,
    updated_at = now()
    WHERE parent_task_id = NEW.id AND status IN ('queued', 'starting', 'running', 'awaiting_input');
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_subagent_terminal_status AFTER UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_subagent_terminal_status();
