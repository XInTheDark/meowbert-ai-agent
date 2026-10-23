import { withTransaction } from "../../lib/db.js";

export class AgentSwarmLaneNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super("Lane not found.");
    this.name = "AgentSwarmLaneNotFoundError";
  }
}

// Stopping a lane from the task page does what the stop tool does, through the same signals the
// worker acts on: working lanes get a stop in their inbox (forced submit at their next step), or with
// discard their cancellation flag, which aborts an in-flight run. Lanes with no run (queued, or waiting
// on lanes of their own and discarded) are flagged and ended by the worker's swarm recovery, which also
// resumes their parent. Sub-lanes are stopped too.
export async function requestAgentSwarmLaneStop(input: { swarmTaskId: string; laneTaskId: string; discard: boolean }): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("SELECT task_id FROM task_swarms WHERE task_id = $1 FOR UPDATE", [input.swarmTaskId]);
    const targets = await client.query<{ task_id: string; status: string }>(
      `WITH RECURSIVE tree AS (
         SELECT task_id, status, 0 AS level FROM task_swarm_lanes WHERE task_id = $1 AND swarm_task_id = $2
         UNION ALL
         SELECT lane.task_id, lane.status, tree.level + 1
           FROM task_swarm_lanes lane JOIN tree ON lane.parent_task_id = tree.task_id
          WHERE tree.level < 4
       )
       SELECT task_id, status FROM tree`,
      [input.laneTaskId, input.swarmTaskId]
    );
    if (targets.rows.length === 0) throw new AgentSwarmLaneNotFoundError();
    for (const lane of targets.rows) {
      if (!["queued", "running", "waiting"].includes(lane.status)) continue;
      const forcedSubmit = !input.discard && lane.status !== "queued";
      if (forcedSubmit) {
        await client.query(
          "INSERT INTO task_swarm_lane_inbox (lane_task_id, swarm_task_id, kind, body) VALUES ($1, $2, 'stop', '')",
          [lane.task_id, input.swarmTaskId]
        );
      } else {
        await client.query(
          "UPDATE tasks SET cancellation_requested = true, resume_after_interrupt = false, updated_at = now() WHERE id = $1",
          [lane.task_id]
        );
      }
    }
  });
}
