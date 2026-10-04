import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  GET_LIVE_SYNC_STATUS_TOOL_NAME,
  LIST_LIVE_SYNC_FILES_TOOL_NAME,
  PULL_LIVE_SYNC_FILE_TOOL_NAME,
  PUSH_LIVE_SYNC_FILE_TOOL_NAME,
  listLiveSyncFilesArgumentsSchema,
  liveSyncMutationArgumentsSchema,
  liveSyncStatusArgumentsSchema
} from "../../agent-tools/index.js";
import { fetchTaskLiveSyncStatus, pullTaskLiveSyncFile, pushTaskLiveSyncFile } from "../../agent/live-sync-client.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

function requireTaskLiveSyncPath(ctx: ToolDispatchContext, path: string) {
  const normalized = path.trim();
  const summary = ctx.liveSyncFiles.find((candidate) => candidate.taskRelativePath === normalized);
  if (!summary) {
    throw new Error("That path is not one of this task's live sync paths. Use list_live_sync_files to see the allowed paths.");
  }
  return summary;
}

export async function handleListLiveSyncFiles(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(LIST_LIVE_SYNC_FILES_TOOL_NAME, outputItem.arguments, listLiveSyncFilesArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Task",
    inputText: "List live sync paths"
  });

  try {
    return await finishBuiltinToolSuccess(ctx, execution, {
      count: ctx.liveSyncFiles.length,
      items: ctx.liveSyncFiles
    }, {
      eventPayload: { liveSyncFileCount: ctx.liveSyncFiles.length }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to list live sync paths: ${message}`);
  }
}

export async function handleGetLiveSyncStatus(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(GET_LIVE_SYNC_STATUS_TOOL_NAME, outputItem.arguments, liveSyncStatusArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const path = parsed.value.path.trim();
  const summary = requireTaskLiveSyncPath(ctx, path);
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Path",
    inputText: path
  });

  try {
    const status = await fetchTaskLiveSyncStatus({
      userId: ctx.actorUserId,
      taskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      taskRelativePath: summary.taskRelativePath
    });
    return await finishBuiltinToolSuccess(ctx, execution, status, {
      eventPayload: { path: summary.taskRelativePath, status: status.status }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to fetch live sync status: ${message}`);
  }
}

async function handleLiveSyncMutation(input: {
  action: "pull" | "push";
  outputItem: ResponseFunctionToolCall;
  ctx: ToolDispatchContext;
  state: ToolDispatchState;
}): Promise<ToolCallResult> {
  await input.ctx.assertNotCancelled();
  const toolName = input.action === "pull" ? PULL_LIVE_SYNC_FILE_TOOL_NAME : PUSH_LIVE_SYNC_FILE_TOOL_NAME;
  const parsed = parseToolArguments(toolName, input.outputItem.arguments, liveSyncMutationArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const path = parsed.value.path.trim();
  const summary = requireTaskLiveSyncPath(input.ctx, path);
  const execution = await startBuiltinToolExecution(input.ctx, input.state, input.outputItem, {
    inputLabel: "Path",
    inputText: parsed.value.force ? `${path} (force)` : path
  });

  try {
    const result = input.action === "pull"
      ? await pullTaskLiveSyncFile({
          userId: input.ctx.actorUserId,
          taskId: input.ctx.taskId,
          workspaceId: input.ctx.workspaceId,
          taskRelativePath: summary.taskRelativePath,
          force: parsed.value.force
        })
      : await pushTaskLiveSyncFile({
          userId: input.ctx.actorUserId,
          taskId: input.ctx.taskId,
          workspaceId: input.ctx.workspaceId,
          taskRelativePath: summary.taskRelativePath,
          force: parsed.value.force
        });

    return await finishBuiltinToolSuccess(input.ctx, execution, result, {
      eventPayload: {
        path: summary.taskRelativePath,
        action: input.action,
        status: result.status,
        force: parsed.value.force === true
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    const actionLabel = input.action === "pull" ? "pull" : "push";
    return finishBuiltinToolFailure(input.ctx, execution, `Failed to ${actionLabel} live sync file: ${message}`);
  }
}

export async function handlePullLiveSyncFile(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  return handleLiveSyncMutation({
    action: "pull",
    outputItem,
    ctx,
    state
  });
}

export async function handlePushLiveSyncFile(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  return handleLiveSyncMutation({
    action: "push",
    outputItem,
    ctx,
    state
  });
}
