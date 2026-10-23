import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { CHECK_TOOL_NAME, checkArgumentsSchema } from "../../../agent-tools/swarm.js";
import { loadAutoCheckFiles, startCheckLane } from "../../../agent-swarm/check.js";
import { hasOwnLanes } from "../../../agent-swarm/lane-store.js";
import { buildCheckStartedMessage } from "../../../agent-swarm/prompt.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { checkSwarmToolRole } from "./role-gate.js";
import { pool } from "../../../../lib/db.js";

async function startCheck(ctx: ToolDispatchContext, state: ToolDispatchState, input: {
  draft: string;
  files: string[];
  focus: string | null;
}): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  let lane;
  try {
    lane = await startCheckLane({
      swarm: ctx.swarm!,
      parentTaskId: ctx.taskId,
      leafMessageId: ctx.getCurrentLeafMessageId(),
      envRoot: ctx.envRoot,
      ...input
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TASK_CANCELLED") throw error;
    return toolErrorResult(message);
  }
  state.swarmPark = { reason: "check" };
  return { output: { lane_id: lane.taskId, message: buildCheckStartedMessage() } };
}

export async function handleCheck(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(CHECK_TOOL_NAME, ctx.swarm?.run);
  if (roleError) return toolErrorResult(roleError);
  if (ctx.codeModeParentCallId) return toolErrorResult("Call check directly, not from exec.");
  if (ctx.swarm!.run.lane && !await hasOwnLanes(pool, ctx.taskId)) {
    return toolErrorResult("Only the leader and lanes that have lanes of their own can start a check. Submit your part instead.");
  }
  const parsed = checkArgumentsSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) return toolErrorResult(`Invalid check arguments: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  return startCheck(ctx, state, parsed.data);
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
  return startCheck(ctx, state, { draft, files, focus: null });
}
