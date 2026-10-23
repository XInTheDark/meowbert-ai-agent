import type { PoolClient } from "pg";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import type { SwarmRunContext } from "./config.js";
import { buildLaneInboxMessage, LANE_STOP_REASON } from "./prompt.js";

export type LaneInboxKind = "steer" | "resume" | "stop";

export async function insertLaneInboxInTx(client: PoolClient, input: {
  laneTaskId: string;
  swarmTaskId: string;
  kind: LaneInboxKind;
  body: string;
}): Promise<void> {
  await client.query(
    "INSERT INTO task_swarm_lane_inbox (lane_task_id, swarm_task_id, kind, body) VALUES ($1, $2, $3, $4)",
    [input.laneTaskId, input.swarmTaskId, input.kind, input.body]
  );
}

// What the parent sent arrives at the lane's next step boundary, appended to the end of its
// conversation. A stop turns the lane's next request into its forced submit.
export async function appendLaneInbox(execution: AgentExecutionContext, swarm: SwarmRunContext | null): Promise<void> {
  const lane = swarm?.lane;
  if (!lane) return;
  let stopped = false;
  await appendRunInboxItems(execution, async (client) => {
    const pending = await client.query<{ id: string; kind: LaneInboxKind; body: string }>(
      `SELECT id, kind, body FROM task_swarm_lane_inbox
        WHERE lane_task_id = $1 AND delivered_at IS NULL
        ORDER BY created_at, id
        FOR UPDATE`,
      [lane.task_id]
    );
    if (pending.rows.length === 0) return [];
    await client.query("UPDATE task_swarm_lane_inbox SET delivered_at = now() WHERE id = ANY($1::uuid[])",
      [pending.rows.map((row) => row.id)]);
    stopped = pending.rows.some((row) => row.kind === "stop");
    return pending.rows.flatMap((row): ResponseInputItem[] => row.kind === "stop"
      ? []
      : [{ role: "user", content: buildLaneInboxMessage(row.kind, row.body) }]);
  });
  if (stopped) swarm.forcedSubmitReason ??= LANE_STOP_REASON;
}
