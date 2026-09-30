CREATE TABLE IF NOT EXISTS task_history_archive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  trigger_source text NOT NULL CHECK (trigger_source IN ('scheduled', 'manual')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'skipped', 'failed')),
  archive_key text,
  original_size_bytes bigint,
  compressed_size_bytes bigint,
  message_count integer,
  event_count integer,
  revision_count integer,
  workflow_message_count integer,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_task_history_archive_runs_recent
  ON task_history_archive_runs(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task_history_archive_runs_queued
  ON task_history_archive_runs(created_at ASC, id ASC)
  WHERE status = 'queued';

INSERT INTO task_history_archive_runs (
  task_id,
  trigger_source,
  status,
  archive_key,
  created_at,
  started_at,
  completed_at
)
SELECT task.id,
       'scheduled',
       'completed',
       task.task_history_archive_key,
       task.task_history_archived_at,
       task.task_history_archived_at,
       task.task_history_archived_at
  FROM tasks task
 WHERE task.task_history_archived_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM task_history_archive_runs run
      WHERE run.task_id = task.id
        AND run.completed_at = task.task_history_archived_at
   );
