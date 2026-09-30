ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS agent_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE subscription_plans
   SET agent_ids_json = '[]'::jsonb
 WHERE agent_ids_json IS NULL
    OR jsonb_typeof(agent_ids_json) <> 'array';
