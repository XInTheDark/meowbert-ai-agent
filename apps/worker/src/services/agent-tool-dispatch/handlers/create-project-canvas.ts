import fsPromises from "node:fs/promises";
import path from "node:path";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { PROJECT_CANVASES_DIR, listCanvasSlugCandidates, normalizeCanvasEntryPath } from "@meowbert/shared";
import { query, withTransaction } from "../../../lib/db.js";
import {
  CREATE_PROJECT_CANVAS_TOOL_NAME,
  createProjectCanvasArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { emitTaskEvent } from "../../runtime/events.js";
import {
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution
} from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage } from "../utils.js";
import { attachProjectCanvasToRun } from "./project-canvas-context.js";

interface ProjectCanvasRow {
  id: string;
  name: string;
  root_path: string;
  entry_path: string;
}

async function findAvailableSlug(environmentId: string, name: string): Promise<string> {
  for (const slug of listCanvasSlugCandidates(name)) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM project_canvases WHERE environment_id = $1 AND slug = $2 LIMIT 1`,
      [environmentId, slug]
    );
    if ((existing.rowCount ?? 0) === 0) {
      return slug;
    }
  }
  throw new Error("Too many canvases with similar names");
}

async function insertProjectCanvas(ctx: ToolDispatchContext, input: {
  name: string;
  slug: string;
  entryPath: string;
}): Promise<ProjectCanvasRow> {
  return withTransaction(async (client) => {
    const result = await client.query<ProjectCanvasRow>(
      `INSERT INTO project_canvases (
         workspace_id, environment_id, name, slug, root_path, entry_path, created_by, last_task_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, root_path, entry_path`,
      [
        ctx.workspaceId,
        ctx.environmentId,
        input.name,
        input.slug,
        `${PROJECT_CANVASES_DIR}/${input.slug}`,
        input.entryPath,
        ctx.actorUserId,
        ctx.taskId
      ]
    );
    await client.query(
      `UPDATE tasks
          SET interactive_canvas_id = $2,
              interactive_canvas_intent = 'create',
              updated_at = now()
        WHERE id = $1`,
      [ctx.taskId, result.rows[0].id]
    );
    return result.rows[0];
  });
}

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
    const name = parsed.value.name.trim();
    const slug = await findAvailableSlug(ctx.environmentId, name);
    const canvasDir = path.resolve(ctx.envRoot, PROJECT_CANVASES_DIR, slug);
    await fsPromises.mkdir(canvasDir, { recursive: true });
    const canvas = await insertProjectCanvas(ctx, {
      name,
      slug,
      entryPath: normalizeCanvasEntryPath(parsed.value.entry_path)
    });

    attachProjectCanvasToRun(ctx, { id: canvas.id, absolutePath: canvasDir, entryPath: canvas.entry_path });
    ctx.appendPromptDelta?.({
      reason: "project_canvas_created",
      content: `Project canvas "${canvas.name}" is in \`$CANVAS_DIR\` (\`${canvasDir}\`). Build the real first version there and call \`show_canvas\` on its entry.`
    });
    await emitTaskEvent(ctx.taskId, "artifact", {
      count: 0,
      canvas: { id: canvas.id, name: canvas.name, rootPath: canvas.root_path, entryPath: canvas.entry_path }
    });

    return await finishBuiltinToolSuccess(ctx, execution, {
      canvas_id: canvas.id,
      name: canvas.name,
      canvas_dir: canvasDir,
      entry_path: canvas.entry_path
    });
  } catch (error) {
    return finishBuiltinToolFailure(ctx, execution, `Failed to create project canvas: ${getErrorMessage(error)}`);
  }
}
