ALTER TABLE task_runs
ADD COLUMN IF NOT EXISTS interrupt_command_step int;
