CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (workspace_id, invited_user_id)
);

CREATE INDEX IF NOT EXISTS workspace_invites_invited_user_status_idx
  ON workspace_invites (invited_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_invites_workspace_status_idx
  ON workspace_invites (workspace_id, status, created_at DESC);
