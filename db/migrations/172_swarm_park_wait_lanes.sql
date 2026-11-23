-- The lanes a parked parent waits on. Null waits on every active direct lane, as before.
ALTER TABLE task_swarm_parks
  ADD COLUMN IF NOT EXISTS wait_lane_ids uuid[];
