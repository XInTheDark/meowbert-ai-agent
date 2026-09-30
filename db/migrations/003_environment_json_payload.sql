ALTER TABLE environments
  ADD COLUMN IF NOT EXISTS json_payload jsonb NOT NULL DEFAULT '{"reasoning":{"effort":"high"}}'::jsonb;

UPDATE environments
   SET json_payload = '{"reasoning":{"effort":"high"}}'::jsonb
 WHERE json_payload IS NULL;
