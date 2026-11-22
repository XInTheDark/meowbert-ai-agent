import { isWithinDormantWindow } from "./dormancy.js";
import type { SwarmLaneListing, SwarmLaneRow, SwarmQueryable } from "./lane-store.js";

export type ListedLaneRow = Pick<SwarmLaneRow,
  "task_id" | "parent_task_id" | "kind" | "title" | "direction" | "status" | "steps" | "spent_tokens" | "result_json" | "merged_at"
> & { user_turns: number };

const DIRECTION_CHARS = 400;
const SUMMARY_CHARS = 1_200;

function clip(text: string | null | undefined, limit: number): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 3)}...` : trimmed;
}

// Only the owner's direct children can be resumed, and only while they are dormant.
function isResumable(lane: ListedLaneRow, ownerTaskId: string, dormantLaneTurns: number): boolean {
  return lane.parent_task_id === ownerTaskId
    && (lane.status === "done" || lane.status === "failed")
    && lane.kind !== "check"
    && lane.merged_at !== null
    && isWithinDormantWindow(lane.user_turns, dormantLaneTurns);
}

// Rows come in creation order; each lane is listed right after its parent.
export function toLaneListing(rows: ListedLaneRow[], ownerTaskId: string, dormantLaneTurns: number): SwarmLaneListing[] {
  const listing: SwarmLaneListing[] = [];
  const visit = (parentTaskId: string) => {
    for (const lane of rows.filter((row) => row.parent_task_id === parentTaskId)) {
      listing.push({
        lane_id: lane.task_id,
        parent_lane_id: lane.parent_task_id === ownerTaskId ? null : lane.parent_task_id,
        title: lane.title,
        kind: lane.kind,
        status: lane.status,
        resumable: isResumable(lane, ownerTaskId, dormantLaneTurns),
        steps: lane.steps,
        spent_tokens: Number(lane.spent_tokens),
        direction: clip(lane.direction, DIRECTION_CHARS),
        summary: clip(lane.result_json?.summary, SUMMARY_CHARS),
        files: (lane.result_json?.files ?? []).map((file) => file.path)
      });
      visit(lane.task_id);
    }
  };
  visit(ownerTaskId);
  return listing;
}

// Every lane below the owner in any status, stopped and expired ones included. Read-only: dormant
// lanes past their window are reported as not resumable rather than marked expired here.
export async function listOwnedLanes(client: SwarmQueryable, input: {
  ownerTaskId: string;
  swarmTaskId: string;
  dormantLaneTurns: number;
}): Promise<SwarmLaneListing[]> {
  const result = await client.query<ListedLaneRow>(
    `WITH RECURSIVE owned AS (
       SELECT task_id, 1 AS level FROM task_swarm_lanes WHERE parent_task_id = $1
       UNION ALL
       SELECT lane.task_id, owned.level + 1
         FROM task_swarm_lanes lane JOIN owned ON lane.parent_task_id = owned.task_id
        WHERE owned.level < 4
     )
     SELECT lane.task_id, lane.parent_task_id, lane.kind, lane.title, lane.direction, lane.status, lane.steps,
            lane.spent_tokens, lane.result_json, lane.merged_at,
            (SELECT COUNT(*)::int FROM task_messages message
              WHERE message.task_id = $2 AND message.role = 'user' AND message.created_at > lane.merged_at) AS user_turns
       FROM owned JOIN task_swarm_lanes lane ON lane.task_id = owned.task_id
      ORDER BY lane.created_at, lane.task_id`,
    [input.ownerTaskId, input.swarmTaskId]
  );
  return toLaneListing(result.rows, input.ownerTaskId, input.dormantLaneTurns);
}
