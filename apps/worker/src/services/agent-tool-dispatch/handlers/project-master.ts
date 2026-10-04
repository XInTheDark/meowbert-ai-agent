import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  cancelTaskSchema,
  createTaskSchema,
  listenToTasksSchema,
  messageTaskSchema
} from "../../agent-tools/project-master.js";
import {
  cancelManagedTask,
  createManagedTask,
  deriveManagedTaskId,
  messageManagedTask
} from "../../project-master/api-client.js";
import { listenToNewTask, setTaskListening } from "../../project-master/listeners.js";
import { createScheduledManagedTask } from "../../project-master/scheduled-tasks.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import type { ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

async function runProjectMasterTool(call: ResponseFunctionToolCall, ctx: ToolDispatchContext) {
  const args: unknown = JSON.parse(call.arguments);
  const listenerTarget = { masterTaskId: ctx.taskId, environmentId: ctx.environmentId };
  switch (call.name) {
    case "create_task": {
      const input = createTaskSchema.parse(args);
      const taskId = deriveManagedTaskId(`${ctx.runId}:${call.call_id}`);
      const listening = input.listen !== false;
      if (input.repeat) {
        const scheduled = await createScheduledManagedTask(ctx, {
          taskId,
          title: input.title ?? null,
          message: input.message,
          repeat: input.repeat,
          timezone: input.timezone ?? null,
          listen: listening
        });
        // The first run starts at creation; next_scheduled_run_at is the run after it.
        return {
          task_id: scheduled.taskId,
          listening,
          first_run: "started_now",
          repeat: scheduled.repeat,
          timezone: scheduled.timezone,
          next_scheduled_run_at: scheduled.nextRunAt
        };
      }
      const created = await createManagedTask(ctx, {
        taskId,
        title: input.title ?? null,
        message: input.message,
        tools: ctx.runToolOptions
      });
      if (listening) await listenToNewTask(listenerTarget, created.taskId);
      return { task_id: created.taskId, listening };
    }
    case "message_task": {
      const input = messageTaskSchema.parse(args);
      // Listening starts before the message so a fast run cannot settle unobserved.
      const listening = input.listen !== false;
      await setTaskListening(listenerTarget, [input.task_id], listening);
      const sent = await messageManagedTask(ctx, { taskId: input.task_id, message: input.message });
      return { task_id: input.task_id, delivery: sent.mode === "enqueued" ? "started" : "queued_for_running_task", listening };
    }
    case "cancel_task": {
      const input = cancelTaskSchema.parse(args);
      await cancelManagedTask(ctx, input.task_id);
      return { task_id: input.task_id, cancellation_requested: true };
    }
    case "listen_to_tasks": {
      const input = listenToTasksSchema.parse(args);
      const taskIds = await setTaskListening(listenerTarget, input.task_ids, input.listen);
      return { task_ids: taskIds, listening: input.listen };
    }
    default: throw new Error("Unknown Master tool.");
  }
}

function summarizeMasterToolInput(call: ResponseFunctionToolCall): string | null {
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    const text = [args.title, args.message, args.task_id, args.task_ids]
      .find((value) => typeof value === "string" || Array.isArray(value));
    return Array.isArray(text) ? text.join(", ") : (text as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function handleProjectMasterTool(
  call: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const execution = await startBuiltinToolExecution(ctx, state, call, {
    inputLabel: "Task",
    inputText: summarizeMasterToolInput(call)
  });
  try {
    if (!ctx.isProjectMaster) throw new Error("Only the Project Master can manage tasks.");
    await ctx.assertNotCancelled();
    const result = await runProjectMasterTool(call, ctx);
    return await finishBuiltinToolSuccess(ctx, execution, result);
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, error instanceof Error ? error.message : String(error));
  }
}
