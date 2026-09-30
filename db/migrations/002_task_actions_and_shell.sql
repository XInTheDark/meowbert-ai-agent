CREATE TABLE IF NOT EXISTS task_message_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES task_messages(id) ON DELETE CASCADE,
  edited_by_user_id uuid REFERENCES users(id),
  old_content_json jsonb NOT NULL,
  new_content_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environment_shell_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  command text NOT NULL,
  cwd text NOT NULL,
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  exit_code int NOT NULL,
  timed_out boolean NOT NULL DEFAULT false,
  duration_ms int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_message_revisions_task ON task_message_revisions(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_env_shell_commands_env ON environment_shell_commands(environment_id, created_at DESC);
