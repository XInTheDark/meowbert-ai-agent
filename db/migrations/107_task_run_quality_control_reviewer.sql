ALTER TABLE task_runs
  DROP CONSTRAINT IF EXISTS task_runs_run_kind_check;

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
