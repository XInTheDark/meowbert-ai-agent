DO $$
DECLARE
  allowed_types_sql text;
BEGIN
  SELECT string_agg(quote_literal(allowed.type), ', ' ORDER BY allowed.type)
    INTO allowed_types_sql
  FROM (
    SELECT DISTINCT task_events.type
      FROM task_events
    UNION
    SELECT unnest(
      ARRAY[
        'status',
        'log',
        'command_start',
        'command_end',
        'model_routed',
        'thinking_start',
        'thinking_end',
        'context_usage',
        'compaction',
        'notification',
        'artifact',
        'error'
      ]
    )
  ) AS allowed(type);

  EXECUTE 'ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_type_check';
  EXECUTE 'ALTER TABLE task_events ADD CONSTRAINT task_events_type_check CHECK (type IN (' || allowed_types_sql || '))';
END $$;
