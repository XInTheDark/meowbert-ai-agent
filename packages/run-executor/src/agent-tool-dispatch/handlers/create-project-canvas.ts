import fsPromises from "node:fs/promises";
import path from "node:path";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { normalizeCanvasEntryPath } from "@meowbert/shared";
import {
  CREATE_PROJECT_CANVAS_TOOL_NAME,
  createProjectCanvasArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import {
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution
} from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage } from "../utils.js";
import { attachProjectCanvasToRun } from "./project-canvas-context.js";

export async function handleCreateProjectCanvas(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(CREATE_PROJECT_CANVAS_TOOL_NAME, outputItem.arguments, createProjectCanvasArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, { inputLabel: parsed.value.name });

  try {
    const canvas = await ctx.control.platform.createProjectCanvas({
      name: parsed.value.name.trim(),
      entryPath: normalizeCanvasEntryPath(parsed.value.entry_path)
    });
    const canvasDir = path.resolve(ctx.envRoot, canvas.rootPath);
    await fsPromises.mkdir(canvasDir, { recursive: true });

    attachProjectCanvasToRun(ctx, { id: canvas.id, absolutePath: canvasDir, entryPath: canvas.entryPath });
    ctx.appendPromptDelta?.({
      reason: "project_canvas_created",
      content: `Project canvas "${canvas.name}" is in \`$CANVAS_DIR\` (\`${canvasDir}\`). Build the real first version there and call \`show_canvas\` on its entry.`
    });
    await ctx.control.emitEvent("artifact", {
      count: 0,
      canvas: { id: canvas.id, name: canvas.name, rootPath: canvas.rootPath, entryPath: canvas.entryPath }
    });

    return await finishBuiltinToolSuccess(ctx, execution, {
      canvas_id: canvas.id,
      name: canvas.name,
      canvas_dir: canvasDir,
      entry_path: canvas.entryPath
    });
  } catch (error) {
    return finishBuiltinToolFailure(ctx, execution, `Failed to create project canvas: ${getErrorMessage(error)}`);
  }
}
