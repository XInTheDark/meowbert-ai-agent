-- NOTIFY is delivered after commit, including changes made by workers and cascades.
ALTER TABLE devices ADD COLUMN stream_connection_id uuid;
CREATE FUNCTION notify_device_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_device text; after_device text; event_kind text;
BEGIN
  IF TG_TABLE_NAME = 'task_run_dispatches' THEN
    event_kind := 'runs';
    IF TG_OP <> 'INSERT' THEN before_device := OLD.payload_json->'executionTarget'->>'deviceId'; END IF;
    IF TG_OP <> 'DELETE' THEN after_device := NEW.payload_json->'executionTarget'->>'deviceId'; END IF;
  ELSIF TG_TABLE_NAME = 'device_file_tombstones' THEN
    event_kind := 'cleanup'; after_device := NEW.device_id::text;
  ELSIF TG_TABLE_NAME = 'devices' THEN
    event_kind := 'revoked'; before_device := OLD.id::text;
  ELSE
    event_kind := 'config';
  END IF;
  IF before_device IS NOT NULL THEN
    PERFORM pg_notify('device_execution_changed', json_build_object('deviceId', before_device, 'kind', event_kind)::text);
  END IF;
  IF (after_device IS NOT NULL AND after_device IS DISTINCT FROM before_device) OR event_kind = 'config' THEN
    PERFORM pg_notify('device_execution_changed', json_build_object('deviceId', after_device, 'kind', event_kind)::text);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER device_dispatch_insert AFTER INSERT ON task_run_dispatches
  FOR EACH ROW EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_dispatch_delete AFTER DELETE ON task_run_dispatches
  FOR EACH ROW EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_dispatch_update AFTER UPDATE OF queue_state, payload_json ON task_run_dispatches
  FOR EACH ROW WHEN (OLD.queue_state IS DISTINCT FROM NEW.queue_state OR OLD.payload_json IS DISTINCT FROM NEW.payload_json)
  EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_cleanup_insert AFTER INSERT ON device_file_tombstones
  FOR EACH ROW EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_cleanup_reschedule AFTER UPDATE OF not_before ON device_file_tombstones
  FOR EACH ROW WHEN (OLD.not_before IS DISTINCT FROM NEW.not_before) EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_revoke_notify AFTER UPDATE OF revoked_at ON devices
  FOR EACH ROW WHEN (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at) EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_delete_notify AFTER DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_image_notify AFTER UPDATE OF sandbox_image_reference, sandbox_image_digest ON platform_settings
  FOR EACH ROW WHEN (OLD.sandbox_image_reference IS DISTINCT FROM NEW.sandbox_image_reference OR OLD.sandbox_image_digest IS DISTINCT FROM NEW.sandbox_image_digest)
  EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_workspace_notify AFTER INSERT OR DELETE OR UPDATE OF file_host ON workspaces
  FOR EACH ROW EXECUTE FUNCTION notify_device_execution();
CREATE TRIGGER device_workspace_member_notify AFTER INSERT OR DELETE OR UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION notify_device_execution();
