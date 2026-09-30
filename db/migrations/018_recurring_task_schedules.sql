ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS default_timezone text NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS task_schedules (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('scheduled', 'infinite')),
  schedule_state text NOT NULL DEFAULT 'active' CHECK (schedule_state IN ('active', 'paused', 'cancelled')),
  repeat_cron text,
  timezone text NOT NULL DEFAULT 'UTC',
  next_run_at timestamptz,
  pending_run boolean NOT NULL DEFAULT false,
  enabled_tools_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_from_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'scheduled' AND repeat_cron IS NOT NULL AND btrim(repeat_cron) <> '')
    OR (mode = 'infinite' AND repeat_cron IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_task_schedules_state_next_run
  ON task_schedules(schedule_state, next_run_at);

CREATE INDEX IF NOT EXISTS idx_task_schedules_state_pending
  ON task_schedules(schedule_state, pending_run);

CREATE INDEX IF NOT EXISTS idx_task_schedules_mode_state
  ON task_schedules(mode, schedule_state);

ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS run_kind text NOT NULL DEFAULT 'default'
  CHECK (run_kind IN ('default', 'compact_only', 'scheduled_auto', 'infinite_auto', 'infinite_checkin'));

ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS notification_requested boolean NOT NULL DEFAULT true;
