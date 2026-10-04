import { organizationHistoryArgumentsSchema, readOrganizedTaskHistory } from "../../agent-db/conversation-history.js";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { normalizeTaskHistorySearchInput } from "@meowbert/shared/task-history-search";
import {
  MEMORY_SEARCH_TOOL_NAME,
  QUERY_TASKS_TOOL_NAME,
  VIEW_TASK_HISTORY_TOOL_NAME,
  memorySearchArgumentsSchema,
  queryTasksArgumentsSchema,
  viewTaskHistoryArgumentsSchema
} from "../../agent-tools/index.js";
import { queryTasks, viewTaskHistory } from "../../agent-db/index.js";
import type { TaskHistoryResult } from "../../agent/types.js";
import { loadListenedTaskIds } from "../../project-master/listeners.js";
import { parseToolArguments } from "../../agent/utils.js";
import { searchMemoryIndex } from "../../memory/index.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";

export async function handleQueryTasks(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(QUERY_TASKS_TOOL_NAME, outputItem.arguments, queryTasksArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const filters = normalizeTaskHistorySearchInput({ ...parsed.value, folderId: parsed.value.folder }, {
    defaultPageSize: 10
  });
  // Relevance has no meaning without a keyword, so plain listings show recent activity first.
  if (!filters.query && filters.sortBy === "relevance") {
    filters.sortBy = "updated_at";
  }
  const searchQuery = filters.query;
  const searchSummary =
    searchQuery
    ?? summarizeToolEventValue({
      status: filters.status,
      scope: filters.scope,
      taskType: filters.taskType,
      folder: filters.folderMode === "folder" ? filters.folderId : filters.folderMode,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      page: filters.page,
      pageSize: filters.pageSize
    })
    ?? "Query tasks";
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: searchQuery ? "Query" : "Filters",
    inputText: searchSummary
  });

  try {
    const results = await queryTasks(ctx.taskId, ctx.environmentId, filters);
    const tasks = ctx.isProjectMaster
      ? await markListenedTasks(ctx.taskId, results.tasks)
      : results.tasks;
    const output = {
      tasks,
      pagination: results.pagination,
      count: tasks.length
    };
    return await finishBuiltinToolSuccess(ctx, execution, output, {
      eventPayload: { resultCount: tasks.length }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to query tasks: ${message}`);
  }
}

async function markListenedTasks(masterTaskId: string, tasks: TaskHistoryResult[]): Promise<TaskHistoryResult[]> {
  const listened = await loadListenedTaskIds(masterTaskId, tasks.map((task) => task.task_id));
  return tasks.map((task) => ({ ...task, listening: listened.has(task.task_id) }));
}

export async function handleViewTaskHistory(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  if (state.organization) {
    return handleOrganizedHistory(outputItem, ctx, state);
  }
  const parsed = parseToolArguments(VIEW_TASK_HISTORY_TOOL_NAME, outputItem.arguments, viewTaskHistoryArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Task",
    inputText: parsed.value.task_id
  });

  try {
    const result = await viewTaskHistory(
      parsed.value.task_id,
      ctx.environmentId,
      parsed.value.max_messages ?? 50
    );

    if (!result) {
      return await finishBuiltinToolFailure(
        ctx,
        execution,
        "Task not found or not accessible in this project."
      );
    }

    return await finishBuiltinToolSuccess(ctx, execution, result);
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to view task history: ${message}`);
  }
}

async function handleOrganizedHistory(outputItem: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  const parsed = parseToolArguments(VIEW_TASK_HISTORY_TOOL_NAME, outputItem.arguments, organizationHistoryArgumentsSchema);
  if (!parsed.ok) { return toolErrorResult(parsed.error); }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Conversation", inputText: parsed.value.task_id ?? ctx.taskId
  });
  try {
    const result = await readOrganizedTaskHistory(parsed.value, { taskId: ctx.taskId, environmentId: ctx.environmentId,
      branchLeafId: ctx.getCurrentLeafMessageId(), allowOtherTasks: ctx.allowTaskHistoryTools === true, staged: state.organization });
    return await finishBuiltinToolSuccess(ctx, execution, result);
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, error instanceof Error ? error.message : String(error));
  }
}

export async function handleMemorySearch(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(MEMORY_SEARCH_TOOL_NAME, outputItem.arguments, memorySearchArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const query = parsed.value.query.trim();
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Query",
    inputText: query
  });

  if (ctx.runToolOptions.memorySearch !== true) {
    return finishBuiltinToolFailure(ctx, execution, "Memory search is disabled for this run.");
  }

  try {
    const output = await searchMemoryIndex({
      workspaceRoot: ctx.workspaceRoot,
      currentProjectId: ctx.environmentId,
      query,
      limit: parsed.value.limit ?? 5,
      scope: parsed.value.scope ?? "all",
      paths: parsed.value.paths ?? null
    });
    const result = {
      query,
      count: output.items.length,
      sync_status: output.sync_status,
      items: output.items
    };

    return await finishBuiltinToolSuccess(ctx, execution, result, {
      eventPayload: {
        memoryResultCount: output.items.length,
        memorySyncState: output.sync_status.state
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to search Memory: ${message}`);
  }
}
