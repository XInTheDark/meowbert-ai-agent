ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_source_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_source_check
    CHECK (source IN ('web', 'telegram', 'discord'));

ALTER TABLE connector_bindings
  DROP CONSTRAINT IF EXISTS connector_bindings_type_check;

ALTER TABLE connector_bindings
  ADD CONSTRAINT connector_bindings_type_check
    CHECK (type IN ('telegram', 'discord'));
