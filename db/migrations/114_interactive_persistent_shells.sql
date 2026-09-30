ALTER TABLE persistent_shell_sessions
  ADD COLUMN mode text NOT NULL DEFAULT 'terminal' CHECK (mode IN ('terminal', 'pipe')),
  ADD COLUMN command_id uuid,
  ADD COLUMN command_exit_code integer,
  ADD COLUMN current_dir text,
  ADD COLUMN output_truncated boolean NOT NULL DEFAULT false;
