import type { PoolClient } from "pg";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import type { SwarmRunContext } from "./config.js";
import { listDormantLanesInTx, type DormantLane } from "./dormancy.js";
import type { SwarmLaneRow } from "./lane-store.js";

type ActiveLane = Pick<SwarmLaneRow, "task_id" | "parent_task_id" | "depth" | "kind" | "title" | "status" | "steps"> & {
  latest_notes: string[] | null;
};

const LATEST_NOTES_PER_LANE = 2;
const SUMMARY_LINE_CHARS = 160;

// A leader run that answers a user message, rather than one woken by its lanes.
export function isUserTurnRun(execution: Pick<AgentExecutionContext, "prepared">): boolean {
  const snapshot = execution.prepared.snapshot;
  const leaf = snapshot.messages.find((message) => message.id === snapshot.branch_leaf_message_id);
  return leaf?.role === "user";
}

async function listActiveLanesInTx(client: PoolClient, swarmTaskId: string): Promise<ActiveLane[]> {
  const result = await client.query<ActiveLane>(
    `SELECT lane.task_id, lane.parent_task_id, lane.depth, lane.kind, lane.title, lane.status, lane.steps,
            (SELECT array_agg(note.content ORDER BY note.seq DESC)
               FROM (SELECT seq, content FROM task_swarm_notes
                      WHERE author_task_id = lane.task_id ORDER BY seq DESC LIMIT $2) note) AS latest_notes
       FROM task_swarm_lanes lane
      WHERE lane.swarm_task_id = $1 AND lane.status IN ('queued', 'running', 'waiting')
      ORDER BY lane.depth, lane.created_at, lane.task_id`,
    [swarmTaskId, LATEST_NOTES_PER_LANE]
  );
  return result.rows;
}

// Lanes listed under their parent, so the leader sees the tree it owns.
export function formatLaneStatus(lanes: ActiveLane[], rootTaskId: string): string[] {
  const lines: string[] = [];
  const visit = (parentTaskId: string, indent: string) => {
    for (const lane of lanes.filter((candidate) => candidate.parent_task_id === parentTaskId)) {
      const notes = (lane.latest_notes ?? []).map((note) => `"${note}"`).join("; ");
      lines.push(`${indent}- ${lane.title} (${lane.kind}, ${lane.status}, ${lane.steps} steps, lane_id ${lane.task_id})${notes ? `: ${notes}` : ""}`);
      visit(lane.task_id, `${indent}  `);
    }
  };
  visit(rootTaskId, "");
  return lines;
}

function firstLine(text: string | undefined): string {
  const line = (text ?? "").trim().split("\n")[0] ?? "";
  return line.length > SUMMARY_LINE_CHARS ? `${line.slice(0, SUMMARY_LINE_CHARS - 3)}...` : line;
}

export function formatDormantLanes(lanes: DormantLane[]): string[] {
  return lanes.map((lane) => `- ${lane.title} (${lane.kind}, ${lane.steps} steps, lane_id ${lane.task_id}): ${firstLine(lane.result_json?.summary)}`);
}

export function buildTurnNotes(input: { active: string[]; dormant: string[] }): string | null {
  const blocks = [
    input.active.length > 0 ? ["[Lanes still working] Answer from this, steer or stop a lane, or start more.", ...input.active].join("\n") : null,
    input.dormant.length > 0 ? ["[Dormant lanes] These finished with their full context kept; resume one for a follow-up on its part.", ...input.dormant].join("\n") : null
  ].filter((block): block is string => block !== null);
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

// At the start of each user turn the leader sees its lanes: those still working, with their latest
// notes, and those it can resume. Appended after the user's message, never into the prefix.
export async function appendSwarmTurnNotes(execution: AgentExecutionContext, swarm: SwarmRunContext | null): Promise<void> {
  if (!swarm || swarm.lane || execution.state.stepCount > 0 || !isUserTurnRun(execution)) return;
  await appendRunInboxItems(execution, async (client) => {
    const active = await listActiveLanesInTx(client, swarm.swarmTaskId);
    const dormant = await listDormantLanesInTx(client, {
      parentTaskId: execution.job.taskId,
      swarmTaskId: swarm.swarmTaskId,
      dormantLaneTurns: swarm.settings.advanced.dormantLaneTurns
    });
    const notes = buildTurnNotes({ active: formatLaneStatus(active, execution.job.taskId), dormant: formatDormantLanes(dormant) });
    return notes ? [{ role: "user", content: notes }] : [];
  });
}
