ALTER TABLE environments
  ALTER COLUMN json_payload
  SET DEFAULT '{"reasoning":{"effort":"high"},"max_context_window_tokens":256000}'::jsonb;

UPDATE environments
   SET json_payload = jsonb_set(
     json_payload,
     '{max_context_window_tokens}',
     to_jsonb(256000),
     true
   )
 WHERE NOT (
   json_payload ? 'max_context_window_tokens'
   AND jsonb_typeof(json_payload->'max_context_window_tokens') = 'number'
 );
