-- Idle compaction for top-level tasks becomes a mode: off, standard (between runs) or full (also
-- inside a run whose next request comes after the prompt cache expired).
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS idle_compaction_mode text NOT NULL DEFAULT 'off'
  CHECK (idle_compaction_mode IN ('off', 'standard', 'full'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'platform_settings' AND column_name = 'idle_compaction_for_tasks'
  ) THEN
    UPDATE platform_settings SET idle_compaction_mode = 'standard' WHERE idle_compaction_for_tasks;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION notify_task_idle(idle_task_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_masters WHERE task_id = idle_task_id)
     OR (
       EXISTS (
         SELECT 1 FROM platform_settings
          WHERE id = 1 AND (idle_compaction_mode <> 'off' OR COALESCE(cachebeat_json->>'mode', 'off') <> 'off')
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

ALTER TABLE platform_settings DROP COLUMN IF EXISTS idle_compaction_for_tasks;
