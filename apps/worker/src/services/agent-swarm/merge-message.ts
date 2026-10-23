import type { AgentSwarmSettings } from "@meowbert/shared";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import type { SwarmRunContext } from "./config.js";
import { TERMINAL_LANE_STATUSES, type SwarmLaneRow } from "./lane-store.js";

type MergedLane = Pick<SwarmLaneRow, "task_id" | "title" | "kind" | "status" | "result_json" | "created_at">;

// Roughly four bytes of text per token; only used to decide whether to suggest an assembly lane.
const BYTES_PER_TOKEN = 4;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  return bytes >= 1024 ? ` (${Math.round(bytes / 1024)} KB)` : ` (${bytes} B)`;
}

export function buildMergeMessage(lanes: MergedLane[], settings: Pick<AgentSwarmSettings, "advanced">): string {
  const sections = lanes.map((lane) => {
    const result = lane.result_json;
    const files = result?.files ?? [];
    return [
      `## ${lane.title} (${lane.kind}, ${lane.status})`,
      result?.summary?.trim() || "No summary.",
      files.length > 0 ? `Files: ${files.map((file) => `${file.path}${formatBytes(file.bytes)}`).join(", ")}` : null
    ].filter((line): line is string => line !== null).join("\n");
  });
  const totalTokens = lanes
    .flatMap((lane) => lane.result_json?.files ?? [])
    .reduce((sum, file) => sum + (file.bytes ?? 0), 0) / BYTES_PER_TOKEN;
  const assemblyHint = totalTokens > settings.advanced.assemblyHintTokens
    ? `The parts total about ${Math.round(totalTokens).toLocaleString("en-US")} tokens. Consider one assembly lane to join them rather than reading them all here.`
    : null;
  return [
    "[Lane results] These lanes have finished. Read the summaries critically before you build on them.",
    ...sections,
    ...(assemblyHint ? [assemblyHint] : [])
  ].join("\n\n");
}

// The merge message is never stored on the lanes: it is built from the parent's finished direct
// lanes that were not merged yet, and claiming them sets merged_at in the transaction that appends
// the message, so each result is delivered exactly once even if the parent's run is retried.
export async function appendSwarmMergeMessage(execution: AgentExecutionContext, swarm: SwarmRunContext | null): Promise<void> {
  if (!swarm) return;
  await appendRunInboxItems(execution, async (client) => {
    const merged = await client.query<MergedLane>(
      `UPDATE task_swarm_lanes
          SET merged_at = now(), updated_at = now()
        WHERE parent_task_id = $1 AND merged_at IS NULL AND status = ANY($2::text[])
        RETURNING task_id, title, kind, status, result_json, created_at`,
      [execution.job.taskId, TERMINAL_LANE_STATUSES]
    );
    if (merged.rows.length === 0) return [];
    const lanes = [...merged.rows].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      || left.task_id.localeCompare(right.task_id));
    return [{ role: "user", content: buildMergeMessage(lanes, swarm.settings) }];
  });
}
