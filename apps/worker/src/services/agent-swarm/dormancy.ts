import type { PoolClient } from "pg";
import type { SwarmLaneRow, SwarmQueryable } from "./lane-store.js";

export type DormantLane = Pick<SwarmLaneRow, "task_id" | "title" | "kind" | "steps" | "result_json">;

// A submitted lane stays resumable while the swarm has had at most `dormantLaneTurns` user messages
// since its result was merged. This is counted from the conversation, so no counter is kept; lanes
// past it are marked expired as they are listed. Check lanes are reviewers, not owners of a part, and
// are not resumed.
export async function listDormantLanesInTx(client: PoolClient, input: {
  parentTaskId: string;
  swarmTaskId: string;
  dormantLaneTurns: number;
}): Promise<DormantLane[]> {
  const result = await client.query<DormantLane & { user_turns: number }>(
    `SELECT lane.task_id, lane.title, lane.kind, lane.steps, lane.result_json,
            (SELECT COUNT(*)::int FROM task_messages message
              WHERE message.task_id = $2 AND message.role = 'user' AND message.created_at > lane.merged_at) AS user_turns
       FROM task_swarm_lanes lane
      WHERE lane.parent_task_id = $1 AND lane.status = 'done' AND lane.kind <> 'check' AND lane.merged_at IS NOT NULL
      ORDER BY lane.created_at, lane.task_id`,
    [input.parentTaskId, input.swarmTaskId]
  );
  const expired = result.rows.filter((lane) => lane.user_turns > input.dormantLaneTurns || input.dormantLaneTurns === 0);
  if (expired.length > 0) {
    await client.query(
      "UPDATE task_swarm_lanes SET status = 'expired', updated_at = now() WHERE task_id = ANY($1::uuid[]) AND status = 'done'",
      [expired.map((lane) => lane.task_id)]
    );
  }
  return result.rows
    .filter((lane) => !expired.includes(lane))
    .map(({ user_turns: _turns, ...lane }) => lane);
}

export async function isLaneResumableInTx(
  client: SwarmQueryable,
  lane: Pick<SwarmLaneRow, "task_id" | "swarm_task_id" | "status" | "kind">,
  dormantLaneTurns: number
): Promise<boolean> {
  if (lane.status !== "done" || lane.kind === "check" || dormantLaneTurns === 0) return false;
  const result = await client.query<{ merged: boolean; user_turns: number }>(
    `SELECT lane.merged_at IS NOT NULL AS merged,
            (SELECT COUNT(*)::int FROM task_messages message
              WHERE message.task_id = $2 AND message.role = 'user' AND message.created_at > lane.merged_at) AS user_turns
       FROM task_swarm_lanes lane
      WHERE lane.task_id = $1`,
    [lane.task_id, lane.swarm_task_id]
  );
  const row = result.rows[0];
  return Boolean(row?.merged) && row.user_turns <= dormantLaneTurns;
}

// Archiving a swarm moves its fork seeds to cold storage, which ends its standing team.
export async function expireSwarmLanes(client: SwarmQueryable, swarmTaskId: string): Promise<void> {
  await client.query(
    "UPDATE task_swarm_lanes SET status = 'expired', updated_at = now() WHERE swarm_task_id = $1 AND status = 'done'",
    [swarmTaskId]
  );
}
