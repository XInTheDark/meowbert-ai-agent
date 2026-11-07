import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { loadProjectMap } from "@meowbert/shared";
import {
  updateProjectMapSchema,
  VIEW_PROJECT_MAP_TOOL_NAME,
  viewProjectMapSchema
} from "@meowbert/run-executor/agent-tools/project-map";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "@meowbert/run-executor/agent-tool-dispatch/events";
import type { ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { rethrowIfTaskCancelled } from "@meowbert/run-executor/agent-tool-dispatch/utils";
import { pool, withTransaction } from "../../../lib/db.js";
import { renderProjectMapForMaster } from "../../project-master/map-view.js";
import { applyProjectMapOperations } from "../../project-master/map-operations.js";

async function runProjectMapTool(call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<unknown> {
  const args: unknown = JSON.parse(call.arguments);
  if (call.name === VIEW_PROJECT_MAP_TOOL_NAME) {
    const input = viewProjectMapSchema.parse(args);
    return { map: renderProjectMapForMaster(await loadProjectMap(pool, ctx.environmentId), input.folder_id) };
  }
  const input = updateProjectMapSchema.parse(args);
  const results = await withTransaction((client) => applyProjectMapOperations(
    client,
    { workspaceId: ctx.workspaceId, environmentId: ctx.environmentId },
    input.operations
  ));
  return { applied: results.length, created: results.filter((result) => result.id).map(({ op, id, ref }) => ({ op, id, ref })) };
}

export async function handleProjectMapTool(
  call: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const execution = await startBuiltinToolExecution(ctx, state, call, {
    inputLabel: "Map",
    inputText: call.name === VIEW_PROJECT_MAP_TOOL_NAME ? "View project map" : "Update project map"
  });
  try {
    if (!ctx.isProjectMaster) throw new Error("Only the Project Master can use the project map tools.");
    await ctx.assertNotCancelled();
    return await finishBuiltinToolSuccess(ctx, execution, await runProjectMapTool(call, ctx));
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, error instanceof Error ? error.message : String(error));
  }
}
