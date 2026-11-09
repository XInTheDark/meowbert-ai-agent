import type { ResponseFunctionToolCall, ResponseInputItem } from "openai/resources/responses/responses";
import { createForkedLanes, type CreatedLane, type NewLane } from "../../../agent-swarm/lane-creation.js";
import { snapshotForkEnvelope, type ForkSeed } from "../../../agent-swarm/fork-seed.js";
import { buildSplitStartedMessage } from "@meowbert/run-executor/agent-swarm/prompt";
import { SwarmToolError } from "../../../agent-swarm/tool-error.js";
import { routesToOtherModel } from "../../../agent-swarm/model-route.js";
import { emitSwarmEvent } from "../../../agent-swarm/events.js";
import type { SwarmDispatchContext } from "@meowbert/run-executor/agent-swarm/dispatch-context";
import { computePromptPrefixHash } from "@meowbert/run-executor/agent/prompt-envelope";
import { serializeToolOutput } from "@meowbert/run-executor/agent-tool-dispatch/state";
import { toolErrorResult, type ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";

const TOOL_CALL_ITEM_TYPES = new Set(["function_call", "custom_tool_call", "apply_patch_call", "computer_call", "local_shell_call"]);

// Every call of the response is recorded before any runs, so a later call would follow this one.
export function isLastToolCallOfResponse(items: ResponseInputItem[], callId: string): boolean {
  const index = items.findIndex((item) => (item as { type?: string; call_id?: string }).type === "function_call"
    && (item as { call_id?: string }).call_id === callId);
  if (index === -1) return false;
  return !items.slice(index + 1).some((item) => TOOL_CALL_ITEM_TYPES.has(String((item as { type?: string }).type)));
}

export function laneLabel(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

// A fork call must be made directly and be the response's last call: its seed is everything up to it.
export function checkForkCallPosition(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): string | null {
  if (ctx.codeModeParentCallId) return `Call ${call.name} directly, not from exec.`;
  if (!isLastToolCallOfResponse(state.conversationItems, call.call_id)) {
    return `${call.name} must be the last tool call in your response. Call it again on its own.`;
  }
  return null;
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

// Lanes on another model share no cache with their parent, so above this size they fork from a
// compacted copy instead of paying for the whole history on every run.
export const CROSS_MODEL_FORK_COMPACTION_MIN_TOKENS = 50_000;

// One compacted copy shared by every lane of the split that runs on another model. Not needed when
// the seed is already compacted or small.
async function captureCrossModelSeed(
  swarm: SwarmDispatchContext,
  state: ToolDispatchState,
  seed: Omit<ForkSeed, "id">,
  crossModelLanes: number
): Promise<Omit<ForkSeed, "id"> | null> {
  const usedTokens = state.contextUsage?.usedTokens ?? 0;
  if (crossModelLanes === 0 || usedTokens <= CROSS_MODEL_FORK_COMPACTION_MIN_TOKENS) return null;
  if (usedTokens > swarm.run.settings.advanced.forkCompactionThresholdTokens) return null;
  return { ...seed, items: await swarm.compactForFork(structuredClone(seed.items), swarm.turn.requestItemCount) };
}

function logForkPrefix(ctx: ToolDispatchContext, swarm: SwarmDispatchContext, created: CreatedLane[]): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[agent-swarm] split prefix", JSON.stringify({
    parentTaskId: ctx.taskId,
    laneTaskIds: created.map((lane) => lane.taskId),
    promptPrefixHash: computePromptPrefixHash({ envelope: swarm.turn.envelope, tools: swarm.turn.responseTools })
  }));
}

// Forks the lanes of a split or diverge call and parks the caller. Each lane's own result for this call
// is its brief; the caller's result lists the lanes it started.
export async function forkLanesFromCall(input: {
  call: ResponseFunctionToolCall;
  ctx: ToolDispatchContext;
  state: ToolDispatchState;
  kind: "split" | "diverge";
  lanes: NewLane[];
  spinePath: string | null;
  buildBrief: (lane: NewLane & { laneDir: string }) => string;
}): Promise<ToolCallResult> {
  const { call, ctx, state } = input;
  const swarm = ctx.swarm!;
  await ctx.assertNotCancelled();
  const seed = await captureSeed(swarm, state, input.spinePath);
  const isCrossModel = (lane: NewLane) => routesToOtherModel(lane.modelRoute, swarm.run.router, swarm.runtime);
  const crossModelSeed = await captureCrossModelSeed(swarm, state, seed, input.lanes.filter(isCrossModel).length);
  let created: CreatedLane[];
  try {
    created = await createForkedLanes({
      swarm: swarm.run,
      parentTaskId: ctx.taskId,
      kind: input.kind,
      seed,
      crossModelSeed,
      isCrossModel,
      lanes: input.lanes,
      envRoot: ctx.envRoot,
      buildForkOutput: (lane) => {
        const brief = input.buildBrief(lane);
        return {
          brief,
          item: { type: "function_call_output", call_id: call.call_id, output: serializeToolOutput({ assignment: brief }, state) }
        };
      }
    });
  } catch (error) {
    if (error instanceof SwarmToolError) return toolErrorResult(error.message);
    throw error;
  }
  state.swarmPark = { reason: "lanes" };
  logForkPrefix(ctx, swarm, created);
  await emitSwarmEvent(swarm.run.swarmTaskId, `Started ${created.length} ${input.kind} lane${created.length === 1 ? "" : "s"}.`);
  return {
    output: {
      lanes: created.map((lane) => ({ lane_id: lane.taskId, label: lane.label, title: lane.title })),
      message: buildSplitStartedMessage(created)
    }
  };
}
