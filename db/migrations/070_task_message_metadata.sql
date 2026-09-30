ALTER TABLE task_messages
  ADD COLUMN IF NOT EXISTS message_metadata_json jsonb;

UPDATE task_messages
   SET message_metadata_json = jsonb_build_object(
     'message_time',
     to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   )
 WHERE role <> 'tool'
   AND (
     message_metadata_json IS NULL
     OR jsonb_typeof(message_metadata_json) <> 'object'
     OR NOT (message_metadata_json ? 'message_time')
     OR jsonb_typeof(message_metadata_json->'message_time') <> 'string'
   );
