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
import { pushParseError } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";

export async function handleScheduleTask(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  if (ctx.isThreadTask) {
    const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
      inputLabel: "Schedule",
      inputText: "Thread runs cannot schedule new tasks."
    });
    await finishBuiltinToolFailure(ctx, state, execution, "schedule_task is unavailable in read-only threads.");
    return;
  }

  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SCHEDULE_TASK_TOOL_NAME, outputItem.arguments, scheduleTaskArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
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

    await finishBuiltinToolSuccess(ctx, state, execution, output, {
      eventPayload: {
        scheduledTaskId: result.taskId,
        scheduledMode: result.mode
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to schedule task: ${message}`);
  }
}

export async function handleEditCurrentTaskSchedule(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(
    EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME,
    outputItem.arguments,
    editCurrentTaskScheduleArgumentsSchema
  );
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
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
    await finishBuiltinToolSuccess(ctx, state, execution, output, {
      eventPayload: {
        mode: result.mode,
        scheduleState: result.state
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to edit task schedule: ${message}`);
  }
}

export async function handleSwarmPauseTool(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<{ kind: "agent_swarm_paused"; response: string } | null> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(
    SWARM_PAUSE_TOOL_NAME,
    outputItem.arguments,
    swarmPauseArgumentsSchema
  );
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return null;
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Swarm pause",
    inputText: parsed.value.status
  });

  if (ctx.runMode !== "agent_swarm_leader" && ctx.runMode !== "agent_swarm_worker") {
    await finishBuiltinToolFailure(
      ctx,
      state,
      execution,
      "swarm_pause can only be used during Agent Swarm runs."
    );
    return null;
  }

  try {
    if (!ctx.workflowActions?.pauseSwarmAgent) {
      await finishBuiltinToolFailure(ctx, state, execution, "swarm_pause is not available for this run.");
      return null;
    }
    await ctx.workflowActions.pauseSwarmAgent({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      status: parsed.value.status,
      waitingForTaskIds: parsed.value.waiting_for_task_ids
    });
    await finishBuiltinToolSuccess(ctx, state, execution, { acknowledged: true, paused: true });
    return { kind: "agent_swarm_paused", response: parsed.value.status };
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to apply swarm wait: ${message}`);
    return null;
  }
}

export async function handleStopTask(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<{ response: string; notify: boolean } | null> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(STOP_TASK_TOOL_NAME, outputItem.arguments, stopTaskArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return null;
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

    await finishBuiltinToolSuccess(ctx, state, execution, output, {
      eventPayload: {
        scheduleState: pauseResult.state,
        mode: pauseResult.mode
      }
    });

    return stopResponse;
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to stop recurring task: ${message}`);
    return null;
  }
}
