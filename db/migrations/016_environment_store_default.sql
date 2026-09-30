ALTER TABLE environments
  ALTER COLUMN json_payload
  SET DEFAULT '{"reasoning":{"effort":"high"},"store":false,"max_context_window_tokens":256000}'::jsonb;

UPDATE environments
   SET json_payload = '{"reasoning":{"effort":"high"},"store":false,"max_context_window_tokens":256000}'::jsonb
 WHERE jsonb_typeof(json_payload) IS DISTINCT FROM 'object';

UPDATE environments
   SET json_payload = jsonb_set(
     json_payload,
     '{store}',
     to_jsonb(false),
     true
   )
 WHERE jsonb_typeof(json_payload) = 'object'
   AND NOT (
     json_payload ? 'store'
     AND jsonb_typeof(json_payload->'store') = 'boolean'
   );
