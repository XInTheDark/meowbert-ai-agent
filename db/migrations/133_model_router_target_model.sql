-- A router target's provider model moves out of its payload into its own "model" field.
-- The payload keeps any other request settings and is empty when there are none.
UPDATE platform_settings
   SET model_routers_json = (
     SELECT jsonb_agg(
       CASE
         WHEN jsonb_typeof(router->'models') = 'array' THEN jsonb_set(router, '{models}', COALESCE((
           SELECT jsonb_agg(
             CASE
               WHEN jsonb_typeof(target) <> 'object' THEN target
               ELSE (target - 'payload')
                 || jsonb_build_object(
                   'model', COALESCE(target->>'model', target->'payload'->>'model', target->>'id'),
                   'payload', CASE
                     WHEN jsonb_typeof(target->'payload') = 'object' THEN (target->'payload') - 'model'
                     ELSE '{}'::jsonb
                   END
                 )
             END
             ORDER BY ordinality
           )
           FROM jsonb_array_elements(router->'models') WITH ORDINALITY AS targets(target, ordinality)
         ), '[]'::jsonb))
         ELSE router
       END
       ORDER BY ordinality
     )
     FROM jsonb_array_elements(model_routers_json) WITH ORDINALITY AS routers(router, ordinality)
   )
 WHERE jsonb_typeof(model_routers_json) = 'array'
   AND jsonb_array_length(model_routers_json) > 0;
