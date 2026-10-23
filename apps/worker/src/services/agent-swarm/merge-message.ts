import type { AgentSwarmSettings } from "@meowbert/shared";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import type { SwarmRunContext } from "./config.js";
import { TERMINAL_LANE_STATUSES, type SwarmLaneResult, type SwarmLaneRow } from "./lane-store.js";

type MergedLane = Pick<SwarmLaneRow, "task_id" | "title" | "kind" | "status" | "result_json" | "created_at"> & {
  spent_tokens?: string;
};

// Roughly four bytes of text per token; only used to decide whether to suggest an assembly lane.
const BYTES_PER_TOKEN = 4;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  return bytes >= 1024 ? ` (${Math.round(bytes / 1024)} KB)` : ` (${bytes} B)`;
}

function formatFiles(result: SwarmLaneResult | null): string | null {
  const files = result?.files ?? [];
  return files.length > 0 ? `Files: ${files.map((file) => `${file.path}${formatBytes(file.bytes)}`).join(", ")}` : null;
}

function formatDecisions(result: SwarmLaneResult | null): string | null {
  const decisions = result?.decisions ?? [];
  if (decisions.length === 0) return null;
  return ["Decisions:", ...decisions.map((decision) =>
    `- ${decision.choice}. Why: ${decision.reason} Would change if: ${decision.would_change_if}`)].join("\n");
}

function formatFindings(result: SwarmLaneResult | null): string {
  const findings = result?.findings ?? [];
  if (findings.length === 0) return "No findings.";
  return findings.map((finding) => `- [${finding.severity}] ${finding.location}: ${finding.issue}`).join("\n");
}

function section(heading: string, lines: Array<string | null>): string {
  return [heading, ...lines].filter((line): line is string => line !== null).join("\n");
}

// Cost is shown only with budgets on, where the parent decides whether a lane is worth resuming.
function formatCost(lane: MergedLane, budgetsEnabled: boolean): string {
  return budgetsEnabled && lane.spent_tokens !== undefined ? `, ${Number(lane.spent_tokens).toLocaleString("en-US")} tokens` : "";
}

function formatSplitLane(lane: MergedLane, budgetsEnabled: boolean): string {
  return section(`## ${lane.title} (${lane.kind}, ${lane.status}${formatCost(lane, budgetsEnabled)}, lane_id ${lane.task_id})`, [
    lane.result_json?.summary?.trim() || "No summary.",
    formatFiles(lane.result_json)
  ]);
}

// Judges favour whatever comes first and whoever they know, so diverged answers are anonymized and
// shown in random order. The UI still shows the real lane titles to the user.
function formatDivergedAnswers(lanes: MergedLane[], budgetsEnabled: boolean, random: () => number): string[] {
  const shuffled = [...lanes];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.map((lane, index) => section(`## Answer ${index + 1} (${lane.status}${formatCost(lane, budgetsEnabled)}, lane_id ${lane.task_id})`, [
    lane.result_json?.summary?.trim() || "No answer.",
    formatDecisions(lane.result_json),
    formatFiles(lane.result_json)
  ]));
}

function formatCheckLane(lane: MergedLane): string {
  return section(`## Check findings (${lane.status})`, [
    lane.result_json?.summary?.trim() || null,
    formatFindings(lane.result_json)
  ]);
}

export function buildMergeMessage(
  lanes: MergedLane[],
  settings: Pick<AgentSwarmSettings, "advanced" | "budgetsEnabled">,
  random: () => number = Math.random
): string {
  const diverged = lanes.filter((lane) => lane.kind === "diverge");
  const sections = [
    ...lanes.filter((lane) => lane.kind === "split").map((lane) => formatSplitLane(lane, settings.budgetsEnabled)),
    ...(diverged.length > 0
      ? ["These answers were worked out independently. Compare their decisions: what they agree on, where they disagree, and ideas only one had. Build from the best whole answer.",
        ...formatDivergedAnswers(diverged, settings.budgetsEnabled, random)]
      : []),
    ...lanes.filter((lane) => lane.kind === "check").map(formatCheckLane)
  ];
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
        RETURNING task_id, title, kind, status, result_json, created_at, spent_tokens::text AS spent_tokens`,
      [execution.job.taskId, TERMINAL_LANE_STATUSES]
    );
    if (merged.rows.length === 0) return [];
    const lanes = [...merged.rows].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      || left.task_id.localeCompare(right.task_id));
    return [{ role: "user", content: buildMergeMessage(lanes, swarm.settings) }];
  });
}
