ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS model_slider_agent_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE platform_settings
   SET model_slider_agent_ids_json = '[]'::jsonb
 WHERE model_slider_agent_ids_json IS NULL
    OR jsonb_typeof(model_slider_agent_ids_json) <> 'array';
