-- Add thinking_start and thinking_end to allowed task_events types
ALTER TABLE task_events DROP CONSTRAINT task_events_type_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_type_check
  CHECK (type IN ('status', 'log', 'command_start', 'command_end', 'thinking_start', 'thinking_end', 'artifact', 'error'));
