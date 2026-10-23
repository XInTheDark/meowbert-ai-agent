import { query } from "../../lib/db.js";

// Outcome logging: a lane's step count is kept current as it works, so the leader's status view and
// the admin outcome view see live numbers.
export async function recordLaneStep(laneTaskId: string): Promise<void> {
  await query("UPDATE task_swarm_lanes SET steps = steps + 1, updated_at = now() WHERE task_id = $1", [laneTaskId]);
}
