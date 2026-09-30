import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { WAIT_TOOL_NAME, waitArgumentsSchema } from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { waitForConditions } from "../../runtime/wait.js";
import { applyInfiniteWait } from "../../task-schedules/service.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { pushParseError } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";

export async function handleWaitTool(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<{ response: string; notify: boolean; seconds: number; nextRunAt: string } | null> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(WAIT_TOOL_NAME, outputItem.arguments, waitArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return null;
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Wait",
    inputText: summarizeToolEventValue(parsed.value) ?? `${parsed.value.seconds}s`
  });
  try {
    const shellSessions = parsed.value.shell_sessions ?? [];
    if (ctx.workflowContext?.workflowType === "agent_swarm" && shellSessions.length === 0) {
      throw new Error("Agent Swarm waits require a shell session condition. Use swarm_pause to wait for swarm work.");
    }
    if (ctx.runMode === "infinite_auto" && shellSessions.length === 0) {
      if (parsed.value.seconds < 60 || !parsed.value.response?.trim()) {
        throw new Error("Infinite recurring time-only waits require seconds between 60 and 604800 and a response.");
      }
      const nextRunAt = await applyInfiniteWait(ctx.taskId, parsed.value.seconds);
      await finishBuiltinToolSuccess(ctx, state, execution, {
        acknowledged: true,
        seconds: parsed.value.seconds,
        next_run_at: nextRunAt
      }, { eventPayload: { waitSeconds: parsed.value.seconds, nextRunAt } });
      return {
        response: parsed.value.response.trim(),
        notify: parsed.value.notify ?? true,
        seconds: parsed.value.seconds,
        nextRunAt
      };
    }
    if (shellSessions.length > 0 && (!ctx.persistentRuntimeEnabled || !ctx.actorUserId)) {
      throw new Error("Waiting on shell sessions requires persistent project shells and an authenticated user.");
    }
    const result = await waitForConditions({
      seconds: parsed.value.seconds,
      shellSessions,
      environmentId: ctx.environmentId,
      taskDir: ctx.taskDir,
      signal: ctx.cancellationSignal,
      assertNotCancelled: ctx.assertNotCancelled
    });
    await finishBuiltinToolSuccess(ctx, state, execution, result);
    return null;
  } catch (err) {
    if (ctx.cancellationSignal?.aborted) throw err;
    rethrowIfTaskCancelled(err);
    if (err instanceof Error && err.message === "RUN_TIME_LIMIT_REACHED") throw err;
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to wait: ${message}`);
    return null;
  }
}
