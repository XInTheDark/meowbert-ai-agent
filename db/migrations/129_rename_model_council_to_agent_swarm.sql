-- Upgrades databases created before the public release, when Agent Swarm was
-- called Model Council. Fresh installs have no council tables, so this does nothing.
--
-- Stored identifiers are rewritten only when a whole value or JSON key is a
-- code identifier (no spaces), so user-written text is left alone.

CREATE FUNCTION pg_temp.swarm_name(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(value,
    'model_council', 'agent_swarm'),
    'MODEL_COUNCIL', 'AGENT_SWARM'),
    'ModelCouncil', 'AgentSwarm'),
    'modelCouncil', 'agentSwarm'),
    'council', 'swarm'),
    'Council', 'Swarm'),
    'COUNCIL', 'SWARM')
$$;

CREATE FUNCTION pg_temp.is_council_identifier(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT value ~ '^[a-z][A-Za-z0-9_.:-]*$' AND value ~* 'council'
$$;

CREATE FUNCTION pg_temp.swarm_json(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      RETURN (
        SELECT coalesce(jsonb_object_agg(
          CASE WHEN pg_temp.is_council_identifier(key) THEN pg_temp.swarm_name(key) ELSE key END,
          pg_temp.swarm_json(child)
        ), '{}'::jsonb)
        FROM jsonb_each(value) AS entry(key, child)
      );
    WHEN 'array' THEN
      RETURN (
        SELECT coalesce(jsonb_agg(pg_temp.swarm_json(child) ORDER BY position), '[]'::jsonb)
        FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(child, position)
      );
    WHEN 'string' THEN
      IF pg_temp.is_council_identifier(value #>> '{}') THEN
        RETURN to_jsonb(pg_temp.swarm_name(value #>> '{}'));
      END IF;
      RETURN value;
    ELSE
      RETURN value;
  END CASE;
END
$$;

DO $$
DECLARE
  item record;
  swarm_table text;
  row_count bigint;
BEGIN
  IF to_regclass('public.task_workflow_council_nodes') IS NULL THEN
    RETURN;
  END IF;

  -- 125_agent_swarm_quotas.sql has just created empty swarm tables; the council ones replace them.
  FOREACH swarm_table IN ARRAY ARRAY[
    'task_workflow_swarm_quota_reservations',
    'task_workflow_swarm_quota_ledger',
    'task_workflow_swarm_node_members',
    'task_workflow_swarm_nodes'
  ] LOOP
    IF to_regclass('public.' || swarm_table) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', swarm_table) INTO row_count;
      IF row_count > 0 THEN
        RAISE EXCEPTION '% already has % rows alongside the council tables; resolve by hand.', swarm_table, row_count;
      END IF;
      EXECUTE format('DROP TABLE %I', swarm_table);
    END IF;
  END LOOP;

  -- Rename tables, then constraints (which also renames their indexes), then remaining indexes.
  FOR item IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE '%council%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I', item.relname, pg_temp.swarm_name(item.relname));
  END LOOP;

  FOR item IN
    SELECT con.conname, rel.relname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public' AND con.conname LIKE '%council%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', item.relname, item.conname, pg_temp.swarm_name(item.conname));
  END LOOP;

  FOR item IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('i', 'S') AND c.relname LIKE '%council%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', item.relname, pg_temp.swarm_name(item.relname));
  END LOOP;

  -- Postgres truncates this generated name differently for the new table name.
  ALTER TABLE task_workflow_swarm_nodes
    RENAME CONSTRAINT task_workflow_swarm_nodes_workflow_task_id_parent_node_id_key
    TO task_workflow_swarm_nodes_workflow_task_id_parent_node_id_g_key;

  -- Drop the checks that only allow the old values, rewrite the data, then add the new checks.
  ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_workflow_type_check;
  ALTER TABLE task_workflows DROP CONSTRAINT IF EXISTS task_workflows_workflow_type_check;
  ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_run_kind_check;

  -- Enum-like text columns.
  FOR item IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = 'text'
      AND c.column_name ~ '(type|kind|mode|role|phase|stage|source|reason|tool|event|status|node_type_id)'
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = pg_temp.swarm_name(%I) WHERE pg_temp.is_council_identifier(%I)',
      item.table_name, item.column_name, item.column_name, item.column_name
    );
  END LOOP;

  -- JSON settings, workflow state and job payloads. Message content, history and logs keep what was written.
  FOR item IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = 'jsonb'
      AND (c.table_name || '.' || c.column_name) NOT IN (
        'task_messages.content_json',
        'task_message_revisions.old_content_json',
        'task_message_revisions.new_content_json',
        'task_context_history_items.payload_json',
        'task_conversation_snapshots.payload_json',
        'audit_logs.meta_json',
        'email_outbox.payload_json',
        'email_inbound_debug_events.details_json',
        'workspace_source_connections.tokens_json'
      )
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = pg_temp.swarm_json(%I) WHERE %I::text ~* ''council''',
      item.table_name, item.column_name, item.column_name, item.column_name
    );
  END LOOP;

  ALTER TABLE tasks
    ADD CONSTRAINT tasks_workflow_type_check
    CHECK (workflow_type IS NULL OR workflow_type IN ('long_horizon', 'agent_swarm'));

  ALTER TABLE task_workflows
    ADD CONSTRAINT task_workflows_workflow_type_check
    CHECK (workflow_type IN ('long_horizon', 'agent_swarm'));

  ALTER TABLE task_runs
    ADD CONSTRAINT task_runs_run_kind_check
    CHECK (
      run_kind IN (
        'default',
        'compact_only',
        'scheduled_auto',
        'infinite_auto',
        'infinite_checkin',
        'long_horizon_clarify',
        'long_horizon_main',
        'long_horizon_reviewer',
        'quality_control_reviewer',
        'agent_swarm_leader',
        'agent_swarm_worker',
        'memory_synthesis'
      )
    );

  -- Platform settings from before the release: unlimited messages is NULL now. Current values are kept.
  ALTER TABLE platform_settings
    ALTER COLUMN allow_user_signup SET DEFAULT false,
    ALTER COLUMN enable_forgot_password SET DEFAULT false,
    ALTER COLUMN require_email_verification_on_signup SET DEFAULT false,
    ALTER COLUMN default_free_message_limit DROP NOT NULL,
    ALTER COLUMN default_free_message_limit DROP DEFAULT;
  ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_default_free_message_limit_check;
  ALTER TABLE platform_settings
    ADD CONSTRAINT platform_settings_default_free_message_limit_check
    CHECK (default_free_message_limit IS NULL OR default_free_message_limit >= 0);

  DELETE FROM schema_migrations WHERE id = '125_model_council_quotas.sql';
END
$$;

DROP FUNCTION pg_temp.swarm_json(jsonb);
DROP FUNCTION pg_temp.is_council_identifier(text);
DROP FUNCTION pg_temp.swarm_name(text);
