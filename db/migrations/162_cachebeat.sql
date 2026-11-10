-- Cachebeat replaces the per-workspace "Cachebeat for Claude models" experiment with a platform
-- setting. The worker keeps an idle Claude task's prompt cache warm, then idle compaction runs.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS cachebeat_json jsonb NOT NULL DEFAULT '{"mode":"off","durationSeconds":7200}'::jsonb;

-- One row per task whose cache is being kept warm, for the request it follows.
CREATE TABLE IF NOT EXISTS task_cachebeats (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  -- The model request this idle period follows; a newer request starts a new period.
  request_started_at timestamptz NOT NULL,
  -- When the cache was last read: that request, or the latest beat that reached the provider.
  cache_read_at timestamptz NOT NULL,
  beats integer NOT NULL DEFAULT 0,
  last_outcome text,
  finished_at timestamptz,
  -- Keeps two workers from beating the same task at once.
  claimed_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idle notifications also cover top-level tasks while cachebeat is on.
CREATE OR REPLACE FUNCTION notify_task_idle(idle_task_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_masters WHERE task_id = idle_task_id)
     OR (
       EXISTS (
         SELECT 1 FROM platform_settings
          WHERE id = 1 AND (idle_compaction_for_tasks OR COALESCE(cachebeat_json->>'mode', 'off') <> 'off')
       )
       AND EXISTS (
         SELECT 1 FROM tasks t
          WHERE t.id = idle_task_id
            AND t.parent_task_id IS NULL
            AND t.workflow_parent_task_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM task_threads tt WHERE tt.task_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM task_swarm_lanes sl WHERE sl.task_id = t.id)
       )
     ) THEN
    PERFORM pg_notify('task_idle', idle_task_id::text);
  END IF;
END;
$$;

-- The workspace experiment toggle is gone.
UPDATE workspace_settings
   SET model_defaults_json = model_defaults_json - 'claudeCacheKeepalive'
 WHERE model_defaults_json ? 'claudeCacheKeepalive';
