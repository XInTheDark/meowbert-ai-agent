-- Agent Swarm: let explicit share notes target siblings, the parent inbox, or both, and optionally wake a parked parent.
ALTER TABLE task_swarm_notes
  ADD COLUMN notify_siblings boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_parent text NOT NULL DEFAULT 'none' CHECK (notify_parent IN ('none', 'inbox', 'wake')),
  ADD COLUMN parent_delivered_at timestamptz;

CREATE INDEX idx_task_swarm_notes_parent_pending
  ON task_swarm_notes (scope_parent_task_id, seq)
  WHERE notify_parent <> 'none' AND parent_delivered_at IS NULL;
