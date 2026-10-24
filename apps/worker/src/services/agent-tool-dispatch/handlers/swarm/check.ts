import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ChosenModelRoute } from "@meowbert/shared";
import { checkArgumentsSchema } from "@meowbert/run-executor/agent-tools/swarm";
import { buildLaneModelRoute, pickCheckModelRoute } from "../../../agent-swarm/model-route.js";
import { SwarmToolError } from "../../../agent-swarm/tool-error.js";
import { emitSwarmEvent } from "../../../agent-swarm/events.js";
import { loadAutoCheckFiles, startCheckLane } from "../../../agent-swarm/check.js";
import { hasOwnLanes } from "../../../agent-swarm/lane-store.js";
import { buildCheckStartedMessage } from "@meowbert/run-executor/agent-swarm/prompt";
import { toolErrorResult, type ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { runSwarmToolCall } from "./swarm-tool-call.js";
import { pool } from "../../../../lib/db.js";

async function startCheck(ctx: ToolDispatchContext, state: ToolDispatchState, input: {
  draft: string;
  files: string[];
  focus: string | null;
  modelRoute: ChosenModelRoute | null;
}): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const lane = await startCheckLane({
    swarm: ctx.swarm!,
    parentTaskId: ctx.taskId,
    leafMessageId: ctx.getCurrentLeafMessageId(),
    envRoot: ctx.envRoot,
    ...input
  });
  state.swarmPark = { reason: "check" };
  await emitSwarmEvent(ctx.swarm!.run.swarmTaskId, "Started a Check lane.");
  return { output: { lane_id: lane.taskId, message: buildCheckStartedMessage() } };
}

export async function handleCheck(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  if (ctx.codeModeParentCallId) return toolErrorResult("Call check directly, not from exec.");
  return runSwarmToolCall(call, ctx, checkArgumentsSchema, async (args) => {
    if (ctx.swarm!.run.lane && !await hasOwnLanes(pool, ctx.taskId)) {
      return toolErrorResult("Only the leader and lanes that have lanes of their own can start a check. Submit your part instead.");
    }
    return startCheck(ctx, state, {
      draft: args.draft,
      files: args.files,
      focus: args.focus,
      modelRoute: buildLaneModelRoute(ctx.swarm!.run.router, args.model, args.effort)
    });
  });
}

// The automatic Check: a leader reply on a turn that used lanes goes to a fresh reviewer first. The
// draft is not delivered; the leader resumes with the findings and replies again. Returns null when
// the reply should be delivered as usual.
export async function interceptFinalResponseForCheck(
  call: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult | null> {
  const swarm = ctx.swarm;
  if (!swarm || swarm.run.lane || !swarm.run.settings.advanced.autoCheck || ctx.codeModeParentCallId) return null;
  const args = (() => {
    try {
      return JSON.parse(call.arguments) as { response?: unknown; partial?: unknown };
    } catch {
      return null;
    }
  })();
  // Partial replies are progress updates, not the deliverable; malformed calls get the usual error.
  const draft = typeof args?.response === "string" ? args.response.trim() : "";
  if (!draft || args?.partial === true) return null;
  const files = await loadAutoCheckFiles(ctx.taskId);
  if (!files) return null;
  try {
    return await startCheck(ctx, state, {
      draft,
      files,
      focus: null,
      modelRoute: pickCheckModelRoute(swarm.run.router, swarm.runtime.model)
    });
  } catch (error) {
    // A Check that cannot start (the fan-out cap) never holds the reply back.
    if (error instanceof SwarmToolError) return null;
    throw error;
  }
}
