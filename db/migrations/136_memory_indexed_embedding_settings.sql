-- The model and templates the current index generation was built with, so the admin panel can
-- show when saved settings no longer match the indexes. Saving settings never re-embeds.
ALTER TABLE memory_embedding_settings
  ADD COLUMN IF NOT EXISTS indexed_settings_json jsonb;

UPDATE memory_embedding_settings
   SET indexed_settings_json = jsonb_build_object(
         'model', model,
         'documentTemplate', document_template,
         'queryTemplate', query_template
       )
 WHERE indexed_settings_json IS NULL;
