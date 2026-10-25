-- Files stay on their original host. A device workspace never stores absolute roots.
ALTER TABLE workspaces ADD COLUMN file_host jsonb;
UPDATE workspaces SET file_host = jsonb_build_object('kind', 'server', 'backendId', storage_backend_id);

CREATE FUNCTION maintain_workspace_file_host() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.file_host->>'kind' IS DISTINCT FROM NEW.file_host->>'kind' THEN
    RAISE EXCEPTION 'A workspace cannot change file host kind';
  END IF;
  IF NEW.file_host IS NULL OR NEW.file_host->>'kind' = 'server' THEN
    NEW.file_host := jsonb_build_object('kind', 'server', 'backendId', NEW.storage_backend_id);
  ELSIF NEW.file_host->>'kind' = 'device' THEN
    IF NOT EXISTS (SELECT 1 FROM devices WHERE id = (NEW.file_host->>'deviceId')::uuid) THEN
      RAISE EXCEPTION 'Workspace device not found';
    END IF;
    NEW.root_path := '';
  ELSE
    RAISE EXCEPTION 'Invalid workspace file host';
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER workspace_file_host BEFORE INSERT OR UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION maintain_workspace_file_host();
ALTER TABLE workspaces ALTER COLUMN file_host SET NOT NULL;

CREATE TABLE device_file_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('task', 'project', 'workspace', 'scratch')),
  target_id uuid NOT NULL,
  relative_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  not_before timestamptz NOT NULL DEFAULT now() + interval '90 seconds',
  acked_at timestamptz
);
CREATE INDEX device_file_tombstones_pending ON device_file_tombstones(device_id, created_at) WHERE acked_at IS NULL;

CREATE TABLE workspace_device_relinks (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  old_device_id uuid NOT NULL REFERENCES devices(id),
  new_device_id uuid NOT NULL REFERENCES devices(id),
  eligible_at timestamptz NOT NULL DEFAULT now() + interval '90 seconds'
);

CREATE FUNCTION record_device_file_deletion() RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE host jsonb;
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    host := OLD.file_host;
    IF host->>'kind' = 'device' THEN
      INSERT INTO device_file_tombstones(device_id, workspace_id, kind, target_id, relative_path)
        VALUES ((host->>'deviceId')::uuid, OLD.id, 'workspace', OLD.id, '');
    END IF;
    INSERT INTO device_file_tombstones(device_id, workspace_id, kind, target_id, relative_path)
      SELECT DISTINCT (t.execution_target->>'deviceId')::uuid, OLD.id, 'scratch', OLD.id, ''
        FROM tasks t WHERE t.workspace_id = OLD.id AND t.execution_target->>'kind' = 'local';
  ELSIF TG_TABLE_NAME = 'environments' THEN
    SELECT file_host INTO host FROM workspaces WHERE id = OLD.workspace_id;
    IF host->>'kind' = 'device' THEN
      INSERT INTO device_file_tombstones(device_id, workspace_id, kind, target_id, relative_path)
        VALUES ((host->>'deviceId')::uuid, OLD.workspace_id, 'project', OLD.id, 'projects/' || OLD.id::text);
    END IF;
  ELSE
    SELECT file_host INTO host FROM workspaces WHERE id = OLD.workspace_id;
    IF host->>'kind' = 'device' THEN
      INSERT INTO device_file_tombstones(device_id, workspace_id, kind, target_id, relative_path)
        VALUES ((host->>'deviceId')::uuid, OLD.workspace_id, 'task', OLD.id,
          'projects/' || OLD.environment_id::text || '/' || OLD.task_root_path);
    END IF;
    IF OLD.execution_target->>'kind' = 'local' THEN
      INSERT INTO device_file_tombstones(device_id, workspace_id, kind, target_id, relative_path)
        VALUES ((OLD.execution_target->>'deviceId')::uuid, OLD.workspace_id, 'scratch', OLD.id, OLD.id::text);
    END IF;
  END IF;
  RETURN OLD;
END;
$body$;
CREATE TRIGGER device_workspace_deletion BEFORE DELETE ON workspaces FOR EACH ROW EXECUTE FUNCTION record_device_file_deletion();
CREATE TRIGGER device_project_deletion BEFORE DELETE ON environments FOR EACH ROW EXECUTE FUNCTION record_device_file_deletion();
CREATE TRIGGER device_task_deletion BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION record_device_file_deletion();

CREATE FUNCTION enforce_device_task_target() RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE host jsonb;
BEGIN
  SELECT file_host INTO host FROM workspaces WHERE id = NEW.workspace_id FOR SHARE;
  IF host->>'kind' = 'device' THEN
    IF NEW.execution_target->>'kind' = 'cloud' THEN
      NEW.execution_target := jsonb_build_object('kind', 'local', 'deviceId', host->>'deviceId', 'mode', 'sandbox');
    END IF;
    IF NEW.execution_target->>'deviceId' IS DISTINCT FROM host->>'deviceId' THEN
      RAISE EXCEPTION 'Task target cannot reach workspace files';
    END IF;
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER device_task_target BEFORE INSERT OR UPDATE OF workspace_id, execution_target ON tasks
  FOR EACH ROW EXECUTE FUNCTION enforce_device_task_target();
