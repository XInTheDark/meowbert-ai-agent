import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  SEARCH_LIVE_SYNC_FOLDER_TOOL_NAME,
  searchLiveSyncFolderArgumentsSchema
} from "../../agent-tools/index.js";
import { searchTaskLiveSyncFolder } from "../../agent/live-sync-client.js";
import type { TaskLiveSyncFileSummary } from "../../agent/live-sync-types.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

const DEFAULT_SEARCH_LIMIT = 25;

export function resolveLiveSyncSearchFolder(
  liveSyncFiles: TaskLiveSyncFileSummary[],
  requestedPath: string
): { link: TaskLiveSyncFileSummary; subfolder: string | null } | null {
  const normalized = requestedPath.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const matches = liveSyncFiles
    .filter((file) => file.provider === "google-drive" && file.linkKind === "folder")
    .filter((file) => normalized === file.taskRelativePath || normalized.startsWith(`${file.taskRelativePath}/`))
    .sort((left, right) => right.taskRelativePath.length - left.taskRelativePath.length);
  const link = matches[0];
  if (!link) {
    return null;
  }
  return { link, subfolder: normalized.slice(link.taskRelativePath.length + 1) || null };
}

export async function handleSearchLiveSyncFolder(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SEARCH_LIVE_SYNC_FOLDER_TOOL_NAME, outputItem.arguments, searchLiveSyncFolderArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const args = parsed.value;
  const target = resolveLiveSyncSearchFolder(ctx.liveSyncFiles, args.path);
  if (!target) {
    return toolErrorResult("That path is not inside a linked Google Drive folder. Use list_live_sync_files to see the linked folders.");
  }
  const query = args.query?.trim() || null;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Search",
    inputText: query ? `${args.path.trim()}: ${query}` : args.path.trim()
  });

  try {
    const result = await searchTaskLiveSyncFolder({
      userId: ctx.actorUserId,
      taskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      taskRelativePath: target.link.taskRelativePath,
      subfolder: target.subfolder,
      depth: args.depth ?? 0,
      filters: {
        query,
        match: args.match ?? "full_text",
        fileTypes: args.file_types ?? [],
        modifiedAfter: args.modified_after ?? null,
        modifiedBefore: args.modified_before ?? null,
        extraQuery: args.extra_query?.trim() || null,
        orderBy: args.order_by ?? "relevance",
        limit: args.limit ?? DEFAULT_SEARCH_LIMIT
      }
    });
    return await finishBuiltinToolSuccess(ctx, execution, result, {
      eventPayload: { path: result.folder, resultCount: result.items.length }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to search live sync folder: ${message}`);
  }
}
