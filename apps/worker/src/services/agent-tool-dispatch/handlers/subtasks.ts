import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  CREATE_SUBTASK_TOOL_NAME,
  START_SUBTASK_TOOL_NAME,
  createSubtaskArgumentsSchema,
  startSubtaskArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { createSubtaskFromTool, startSubtasksFromTool } from "../../tasks/subtasks.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { pushParseError } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";

export async function handleCreateSubtask(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  if (ctx.isThreadTask) {
    const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
      inputLabel: "Subtask",
      inputText: "Thread runs cannot create subtasks."
    });
    await finishBuiltinToolFailure(ctx, state, execution, "create_subtask is unavailable in read-only threads.");
    return;
  }

  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(CREATE_SUBTASK_TOOL_NAME, outputItem.arguments, createSubtaskArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: parsed.value.title ? "Subtask" : "Message",
    inputText: parsed.value.title ?? parsed.value.message
  });

  try {
    const result = await createSubtaskFromTool({
      parentTaskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      environmentId: ctx.environmentId,
      message: parsed.value.message,
      title: parsed.value.title,
      enabledTools: parsed.value.enabled_tools,
      fallbackToolOptions: ctx.runToolOptions
    });

    const output = {
      ok: true,
      task_id: result.taskId,
      title: result.title,
      status: result.status,
      subtask_depth: result.subtaskDepth,
      task_root_path: result.taskRootPath,
      created_at: result.createdAt
    };

    await finishBuiltinToolSuccess(ctx, state, execution, output, {
      eventPayload: {
        subtaskId: result.taskId
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to create subtask: ${message}`);
  }
}

export async function handleStartSubtask(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  if (ctx.isThreadTask) {
    const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
      inputLabel: "Tasks",
      inputText: "Thread runs cannot start subtasks."
    });
    await finishBuiltinToolFailure(ctx, state, execution, "start_subtask is unavailable in read-only threads.");
    return;
  }

  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(START_SUBTASK_TOOL_NAME, outputItem.arguments, startSubtaskArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Tasks",
    inputText: summarizeToolEventValue({
      task_ids: parsed.value.task_ids,
      timeout_seconds: parsed.value.timeout_seconds
    }) ?? parsed.value.task_ids.join("\n")
  });

  try {
    const output = await startSubtasksFromTool({
      parentTaskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      environmentId: ctx.environmentId,
      taskIds: parsed.value.task_ids,
      timeoutSeconds: parsed.value.timeout_seconds
    });

    await finishBuiltinToolSuccess(ctx, state, execution, output, {
      eventPayload: {
        subtaskCount: output.subtasks.length
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to start subtasks: ${message}`);
  }
}
