import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  SWARM_PAUSE_TOOL_NAME,
  EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
  SCHEDULE_TASK_TOOL_NAME,
  STOP_TASK_TOOL_NAME,
  swarmPauseArgumentsSchema,
  editCurrentTaskScheduleArgumentsSchema,
  scheduleTaskArgumentsSchema,
  stopTaskArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { createRecurringTaskFromTool, editCurrentTaskSchedule, pauseRecurringSchedule } from "../../task-schedules/service.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";
import { withSwarmPause } from "./workflows.js";

export async function handleScheduleTask(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  if (ctx.isThreadTask) {
    const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
      inputLabel: "Schedule",
      inputText: "Thread runs cannot schedule new tasks."
    });
    return finishBuiltinToolFailure(ctx, execution, "schedule_task is unavailable in read-only threads.");
  }

  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SCHEDULE_TASK_TOOL_NAME, outputItem.arguments, scheduleTaskArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Message",
    inputText: parsed.value.message,
    extraEventPayload: { mode: parsed.value.mode }
  });

  try {
    const result = await createRecurringTaskFromTool({
      parentTaskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      environmentId: ctx.environmentId,
      source: ctx.triggerSource,
      connectorContextId: ctx.connectorContextId,
      defaultTimezone: ctx.defaultTimezone,
      currentToolOptions: ctx.runToolOptions,
      message: parsed.value.message,
      mode: parsed.value.mode,
      repeat: parsed.value.repeat,
      timezone: parsed.value.timezone,
      enabledTools: parsed.value.enabled_tools
    });

    const output = {
      ok: true,
      task_id: result.taskId,
      run_id: result.runId,
      mode: result.mode,
      schedule_state: result.scheduleState,
      repeat: result.repeat,
      timezone: result.timezone,
      next_run_at: result.nextRunAt
    };

    return await finishBuiltinToolSuccess(ctx, execution, output, {
      eventPayload: {
        scheduledTaskId: result.taskId,
        scheduledMode: result.mode
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to schedule task: ${message}`);
  }
}

export async function handleEditCurrentTaskSchedule(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(
    EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
    outputItem.arguments,
    editCurrentTaskScheduleArgumentsSchema
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Schedule",
    inputText: summarizeToolEventValue({
      repeat: parsed.value.repeat,
      timezone: parsed.value.timezone,
      enabled_tools: parsed.value.enabled_tools
    }) ?? "Edit current task schedule"
  });

  try {
    const result = await editCurrentTaskSchedule({
      taskId: ctx.taskId,
      repeat: parsed.value.repeat,
      timezone: parsed.value.timezone,
      enabledTools: parsed.value.enabled_tools
    });

    const output = {
      ok: true,
      mode: result.mode,
      state: result.state,
      repeat: result.repeat,
      timezone: result.timezone,
      next_run_at: result.nextRunAt
    };
    return await finishBuiltinToolSuccess(ctx, execution, output, {
      eventPayload: {
        mode: result.mode,
        scheduleState: result.state
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to edit task schedule: ${message}`);
  }
}

export async function handleSwarmPauseTool(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(
    SWARM_PAUSE_TOOL_NAME,
    outputItem.arguments,
    swarmPauseArgumentsSchema
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Swarm pause",
    inputText: parsed.value.status
  });

  if (ctx.runMode !== "agent_swarm_leader" && ctx.runMode !== "agent_swarm_worker") {
    return finishBuiltinToolFailure(
      ctx,
      execution,
      "swarm_pause can only be used during Agent Swarm runs."
    );
  }

  try {
    if (!ctx.workflowActions?.pauseSwarmAgent) {
      return await finishBuiltinToolFailure(ctx, execution, "swarm_pause is not available for this run.");
    }
    const { escalation } = await ctx.workflowActions.pauseSwarmAgent({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      status: parsed.value.status,
      waitingForTaskIds: parsed.value.wait_for_task_ids
    });
    const finished = await finishBuiltinToolSuccess(ctx, execution, { acknowledged: true, paused: true });
    return withSwarmPause(finished, parsed.value.status, escalation);
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to apply swarm wait: ${message}`);
  }
}

export async function handleStopTask(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(STOP_TASK_TOOL_NAME, outputItem.arguments, stopTaskArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Stop",
    inputText: summarizeToolEventValue({
      response: parsed.value.response,
      notify: parsed.value.notify ?? true
    }) ?? "Stop recurring task"
  });

  try {
    const pauseResult = await pauseRecurringSchedule(ctx.taskId);
    const stopResponse = {
      response: parsed.value.response.trim(),
      notify: parsed.value.notify ?? true
    };

    const output = {
      acknowledged: true,
      mode: pauseResult.mode,
      schedule_state: pauseResult.state,
      repeat: pauseResult.repeat,
      timezone: pauseResult.timezone,
      next_run_at: pauseResult.nextRunAt,
      notify: stopResponse.notify
    };

    const finished = await finishBuiltinToolSuccess(ctx, execution, output, {
      eventPayload: {
        scheduleState: pauseResult.state,
        mode: pauseResult.mode
      }
    });
    return { ...finished, stopRequest: stopResponse };
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to stop recurring task: ${message}`);
  }
}
