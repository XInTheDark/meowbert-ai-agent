ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS model_metadata_json jsonb NOT NULL DEFAULT '{"default":{"context_window":256000}}'::jsonb;

UPDATE platform_settings
   SET model_metadata_json = '{"default":{"context_window":256000}}'::jsonb
 WHERE model_metadata_json IS NULL
    OR jsonb_typeof(model_metadata_json) <> 'object';

UPDATE platform_settings
   SET model_metadata_json = jsonb_set(
     model_metadata_json,
     '{default}',
     '{"context_window":256000}'::jsonb,
     true
   )
 WHERE NOT (model_metadata_json ? 'default')
    OR jsonb_typeof(model_metadata_json->'default') <> 'object';

UPDATE platform_settings
   SET model_metadata_json = jsonb_set(
     model_metadata_json,
     '{default,context_window}',
     '256000'::jsonb,
     true
   )
 WHERE jsonb_typeof(model_metadata_json->'default'->'context_window') <> 'number';
