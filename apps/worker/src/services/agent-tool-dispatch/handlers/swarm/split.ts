import type { ResponseFunctionToolCall, ResponseInputItem } from "openai/resources/responses/responses";
import { SPLIT_TOOL_NAME, splitArgumentsSchema } from "../../../agent-tools/swarm.js";
import { createForkedLanes, type NewLane } from "../../../agent-swarm/lane-creation.js";
import { snapshotForkEnvelope, type ForkSeed } from "../../../agent-swarm/fork-seed.js";
import { buildLaneBrief, buildSplitStartedMessage } from "../../../agent-swarm/prompt.js";
import type { SwarmDispatchContext } from "../../../agent-swarm/dispatch-context.js";
import { computePromptPrefixHash } from "../../../agent/prompt-envelope.js";
import { serializeToolOutput } from "../../state.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { checkSwarmToolRole } from "./role-gate.js";

const TOOL_CALL_ITEM_TYPES = new Set(["function_call", "custom_tool_call", "apply_patch_call", "computer_call", "local_shell_call"]);

// Every call of the response is recorded before any runs, so a later call would follow this one.
export function isLastToolCallOfResponse(items: ResponseInputItem[], callId: string): boolean {
  const index = items.findIndex((item) => (item as { type?: string; call_id?: string }).type === "function_call"
    && (item as { call_id?: string }).call_id === callId);
  if (index === -1) return false;
  return !items.slice(index + 1).some((item) => TOOL_CALL_ITEM_TYPES.has(String((item as { type?: string }).type)));
}

function laneLabel(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

// Everything the lanes inherit: the parent's prefix, tools and conversation up to this call, which is
// the request that just wrote the provider cache. Above the threshold they share one compacted copy.
async function captureSeed(swarm: SwarmDispatchContext, state: ToolDispatchState, spinePath: string | null): Promise<Omit<ForkSeed, "id">> {
  let items = structuredClone(state.conversationItems);
  const usedTokens = state.contextUsage?.usedTokens ?? 0;
  if (usedTokens > swarm.run.settings.advanced.forkCompactionThresholdTokens) {
    items = await swarm.compactForFork(items, swarm.turn.requestItemCount);
  }
  return {
    envelope: snapshotForkEnvelope(swarm.turn.envelope),
    tools: { response: structuredClone(swarm.turn.responseTools), codeMode: structuredClone(swarm.turn.codeModeTools) },
    items,
    capabilities: {
      runtime: structuredClone(swarm.runtime),
      runToolOptions: structuredClone(swarm.runToolOptions),
      loadedToolGroups: [...swarm.loadedToolGroups],
      spinePath
    }
  };
}

export async function handleSplit(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(SPLIT_TOOL_NAME, ctx.swarm?.run);
  if (roleError) return toolErrorResult(roleError);
  const swarm = ctx.swarm!;
  if (ctx.codeModeParentCallId) return toolErrorResult("Call split directly, not from exec.");
  if (!isLastToolCallOfResponse(state.conversationItems, call.call_id)) {
    return toolErrorResult("split must be the last tool call in your response. Call it again on its own.");
  }
  const parsed = splitArgumentsSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) return toolErrorResult(`Invalid split arguments: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  const maxLanes = swarm.run.settings.advanced.maxLanesPerParent;
  if (parsed.data.lanes.length > maxLanes) return toolErrorResult(`Split into at most ${maxLanes} lanes.`);

  await ctx.assertNotCancelled();
  const lanes: NewLane[] = parsed.data.lanes.map((lane, index) => ({
    label: laneLabel(index),
    title: lane.title,
    direction: lane.direction,
    weight: lane.weight ?? 1
  }));
  const spinePath = parsed.data.spine_path;
  const seed = await captureSeed(swarm, state, spinePath);
  let created;
  try {
    created = await createForkedLanes({
      swarm: swarm.run,
      parentTaskId: ctx.taskId,
      kind: "split",
      seed,
      lanes,
      envRoot: ctx.envRoot,
      buildForkOutput: (lane) => {
        const brief = buildLaneBrief({
          label: lane.label,
          title: lane.title,
          direction: lane.direction,
          laneDir: lane.laneDir,
          spinePath,
          siblingTitles: lanes.filter((other) => other.label !== lane.label).map((other) => `${other.label} ${other.title}`)
        });
        return {
          brief,
          item: { type: "function_call_output", call_id: call.call_id, output: serializeToolOutput({ assignment: brief }, state) }
        };
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TASK_CANCELLED") throw error;
    return toolErrorResult(message);
  }
  state.swarmPark = { reason: "lanes" };
  if (process.env.NODE_ENV !== "production") {
    console.info("[agent-swarm] split prefix", JSON.stringify({
      parentTaskId: ctx.taskId,
      laneTaskIds: created.map((lane) => lane.taskId),
      promptPrefixHash: computePromptPrefixHash({ envelope: swarm.turn.envelope, tools: swarm.turn.responseTools })
    }));
  }
  return {
    output: {
      lanes: created.map((lane) => ({ lane_id: lane.taskId, label: lane.label, title: lane.title })),
      message: buildSplitStartedMessage(created)
    }
  };
}
