import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { WAIT_TOOL_NAME, waitArgumentsSchema } from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { waitForConditions } from "../shell-wait.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";

// An empty lane list waits on every active lane; otherwise only on the named ones.
async function handleSwarmLaneWait(
  ctx: ToolDispatchContext,
  state: ToolDispatchState,
  execution: Awaited<ReturnType<typeof startBuiltinToolExecution>>,
  requestedLaneIds: string[]
): Promise<ToolCallResult> {
  if (!ctx.swarm) {
    throw new Error("Waiting on lanes is only available in Agent Swarm runs.");
  }
  if (ctx.codeModeParentCallId) {
    throw new Error("Call wait with lanes directly, not from exec.");
  }
  const laneIds = requestedLaneIds.length > 0 ? [...new Set(requestedLaneIds)] : null;
  if (await ctx.features.hasActiveSwarmLanes(ctx, laneIds)) {
    state.swarmPark = laneIds ? { reason: "lanes", laneIds } : { reason: "lanes" };
    return finishBuiltinToolSuccess(ctx, execution, {
      waiting: true,
      reason: "lanes",
      message: laneIds
        ? "Your turn ends now; you resume with their results once those lanes have finished."
        : "Your turn ends now; you resume with your lanes' results once every active lane has finished."
    });
  }
  return finishBuiltinToolSuccess(ctx, execution, {
    waiting: false,
    reason: "no_active_lanes",
    message: laneIds
      ? "None of those lanes is active. Any completed lane results will arrive on your next step."
      : "No active lanes are running. Any completed lane results will arrive on your next step."
  });
}

export async function handleWaitTool(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(WAIT_TOOL_NAME, outputItem.arguments, waitArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Wait",
    inputText: summarizeToolEventValue(parsed.value) ?? (Array.isArray(parsed.value.lanes) ? "lanes" : `${parsed.value.seconds}s`)
  });
  try {
    if (Array.isArray(parsed.value.lanes)) {
      return await handleSwarmLaneWait(ctx, state, execution, parsed.value.lanes);
    }
    const seconds = parsed.value.seconds;
    if (typeof seconds !== "number") {
      throw new Error("Waiting requires seconds or lanes.");
    }
    const shellSessions = parsed.value.shell_sessions ?? [];
    if (ctx.runMode === "infinite_auto" && shellSessions.length === 0) {
      if (seconds < 60 || !parsed.value.response?.trim()) {
        throw new Error("Infinite recurring time-only waits require seconds between 60 and 604800 and a response.");
      }
      const nextRunAt = await ctx.control.platform.applyInfiniteWait(seconds);
      const finished = await finishBuiltinToolSuccess(ctx, execution, {
        acknowledged: true,
        seconds,
        next_run_at: nextRunAt
      }, { eventPayload: { waitSeconds: seconds, nextRunAt } });
      return {
        ...finished,
        waitRequest: {
          response: parsed.value.response.trim(),
          notify: parsed.value.notify ?? true,
          seconds,
          nextRunAt
        }
      };
    }
    if (shellSessions.length > 0 && (!ctx.persistentRuntimeEnabled || !ctx.actorUserId)) {
      throw new Error("Waiting on shell sessions requires persistent project shells and an authenticated user.");
    }
    const result = await waitForConditions({
      seconds,
      shellSessions,
      readSession: (sessionId) => ctx.control.platform.readShellSessionWaitState({ sessionId }),
      signal: ctx.cancellationSignal,
      assertNotCancelled: ctx.assertNotCancelled
    });
    return await finishBuiltinToolSuccess(ctx, execution, result);
  } catch (err) {
    if (ctx.cancellationSignal?.aborted) throw err;
    rethrowIfTaskCancelled(err);
    if (err instanceof Error && err.message === "RUN_TIME_LIMIT_REACHED") throw err;
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to wait: ${message}`);
  }
}
