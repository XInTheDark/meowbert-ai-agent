import fsPromises from "node:fs/promises";
import path from "node:path";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { query, withTransaction } from "../../../lib/db.js";
import {
  CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
  createInteractiveCanvasArgumentsSchema
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

interface ProjectCanvasRow {
  id: string;
  name: string;
  slug: string;
  root_path: string;
  entry_path: string;
  runtime_mode: "static" | "dev_server";
  dev_server_json: Record<string, unknown>;
}

function slugifyCanvasName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "interactive-canvas";
}

function normalizeEntryPath(value: string | null | undefined): string {
  const entryPath = (value ?? "index.html").trim().replace(/^\/+/, "");
  if (!entryPath || entryPath.includes("..") || path.isAbsolute(entryPath)) {
    return "index.html";
  }
  return entryPath;
}

async function createAvailableCanvasSlug(environmentId: string, name: string): Promise<string> {
  const baseSlug = slugifyCanvasName(name);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const existing = await query<{ id: string }>(
      `SELECT id
         FROM project_canvases
        WHERE environment_id = $1
          AND slug = $2
        LIMIT 1`,
      [environmentId, slug]
    );
    if ((existing.rowCount ?? 0) === 0) {
      return slug;
    }
  }
  return `${baseSlug}-${Date.now()}`;
}

async function writeCanvasManifest(input: {
  canvasDir: string;
  title: string;
  entryPath: string;
  runtimeMode: "static" | "dev_server";
  devCommand: string | null;
  devPort: number | null;
  description: string | null;
}): Promise<void> {
  await fsPromises.mkdir(input.canvasDir, { recursive: true });
  await fsPromises.writeFile(
    path.join(input.canvasDir, "canvas.json"),
    `${JSON.stringify({
      title: input.title,
      entry: input.entryPath,
      runtimeMode: input.runtimeMode,
      devCommand: input.devCommand,
      port: input.devPort,
      description: input.description
    }, null, 2)}\n`,
    "utf8"
  );
}

export async function handleCreateInteractiveCanvas(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(
    CREATE_INTERACTIVE_CANVAS_TOOL_NAME,
    outputItem.arguments,
    createInteractiveCanvasArgumentsSchema
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const args = parsed.value;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: args.name
  });

  try {
    const runtimeMode = args.runtime_mode === "dev_server" ? "dev_server" : "static";
    const entryPath = normalizeEntryPath(args.entry_path);
    const slug = await createAvailableCanvasSlug(ctx.environmentId, args.name);
    const rootPath = `canvases/${slug}`;
    const canvasDir = path.resolve(ctx.envRoot, rootPath);
    const devServer = runtimeMode === "dev_server"
      ? {
          command: args.dev_command ?? "npm run dev",
          port: args.dev_port ?? 5173
        }
      : {};

    await writeCanvasManifest({
      canvasDir,
      title: args.name,
      entryPath,
      runtimeMode,
      devCommand: typeof devServer.command === "string" ? devServer.command : null,
      devPort: typeof devServer.port === "number" ? devServer.port : null,
      description: args.description ?? null
    });

    const canvas = await withTransaction(async (client) => {
      const result = await client.query<ProjectCanvasRow>(
        `INSERT INTO project_canvases (
           workspace_id,
           environment_id,
           name,
           slug,
           root_path,
           entry_path,
           runtime_mode,
           dev_server_json,
           created_by,
           last_task_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         RETURNING id,
                   name,
                   slug,
                   root_path,
                   entry_path,
                   runtime_mode,
                   dev_server_json`,
        [
          ctx.workspaceId,
          ctx.environmentId,
          args.name,
          slug,
          rootPath,
          entryPath,
          runtimeMode,
          JSON.stringify(devServer),
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

    ctx.shellEnvOverrides.CANVAS_DIR = canvasDir;
    ctx.shellEnvOverrides.MEOWBERT_CANVAS_DIR = canvasDir;
    ctx.shellEnvOverrides.CANVAS_ID = canvas.id;
    ctx.shellEnvOverrides.CANVAS_ENTRY_PATH = canvas.entry_path;
    ctx.appendPromptDelta?.({
      reason: "interactive_canvas_created",
      content: [
        "## Interactive Canvas Created",
        "",
        `Canvas id: ${canvas.id}`,
        `Canvas directory: \`${canvasDir}\` (also available as \`$CANVAS_DIR\` for later shell calls)`,
        `Entry path: \`${canvas.entry_path}\``,
        "",
        "Write the website files directly under the canvas directory. Do not create a placeholder page unless it is the real first version of the user's requested canvas."
      ].join("\n")
    });

    await emitTaskEvent(ctx.taskId, "log", {
      message: `Interactive Canvas created: ${canvas.name}`,
      interactiveCanvas: {
        id: canvas.id,
        name: canvas.name,
        rootPath: canvas.root_path,
        entryPath: canvas.entry_path,
        runtimeMode: canvas.runtime_mode
      }
    });

    return await finishBuiltinToolSuccess(ctx, execution, {
      canvas_id: canvas.id,
      name: canvas.name,
      root_path: canvas.root_path,
      canvas_dir: canvasDir,
      entry_path: canvas.entry_path,
      runtime_mode: canvas.runtime_mode,
      dev_server: canvas.dev_server_json,
      next_steps: "Create or update the website files in canvas_dir, then keep canvas.json current."
    });
  } catch (error) {
    return finishBuiltinToolFailure(ctx, execution, `Failed to create Interactive Canvas: ${getErrorMessage(error)}`);
  }
}
