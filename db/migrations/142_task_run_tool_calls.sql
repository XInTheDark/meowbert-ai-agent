-- Tool calls a run has started and not yet finished. A row is removed when its result is recorded,
-- so rows left behind by an ended run are calls whose outcome is unknown. The next run of the task
-- reports them to the agent instead of replaying them.
CREATE TABLE task_run_tool_calls (
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  arguments text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, call_id)
);
CREATE INDEX idx_task_run_tool_calls_task ON task_run_tool_calls(task_id);
