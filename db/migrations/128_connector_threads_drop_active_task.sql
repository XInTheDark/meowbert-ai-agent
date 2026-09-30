-- Connector chats no longer track a single "active task": every inbound message goes to the
-- project's Master, and the Master's reply address lives on tasks.connector_context_id.
ALTER TABLE connector_threads DROP COLUMN IF EXISTS active_task_id;
