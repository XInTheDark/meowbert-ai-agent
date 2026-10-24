import { query, withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import { lockSwarmInTx } from "./scheduler.js";

// A parked leader has no open run to finish its cancellation.
export async function endCancelledIdleLeaders(limit: number): Promise<void> {
  const leaders = await query<{ task_id: string }>(
    `SELECT park.task_id FROM task_swarm_parks park
       JOIN tasks task ON task.id = park.task_id
      WHERE park.task_id = park.swarm_task_id AND task.cancellation_requested
        AND NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = park.task_id AND run.ended_at IS NULL)
      ORDER BY park.created_at LIMIT $1`,
    [limit]
  );
  for (const leader of leaders.rows) {
    const ended = await withTransaction(async (client) => {
      await lockSwarmInTx(client, leader.task_id);
      await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [leader.task_id]);
      const result = await client.query(
        `UPDATE tasks SET status = 'cancelled', completed_at = now(), resume_after_interrupt = false, updated_at = now()
          WHERE id = $1 AND cancellation_requested
            AND NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = $1 AND run.ended_at IS NULL)
          RETURNING id`,
        [leader.task_id]
      );
      if (!result.rowCount) return false;
      await client.query("DELETE FROM task_swarm_parks WHERE task_id = $1", [leader.task_id]);
      return true;
    });
    if (ended) await emitTaskEvent(leader.task_id, "status", { status: "cancelled" });
  }
}
