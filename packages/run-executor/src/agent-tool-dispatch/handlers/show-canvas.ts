import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { isWithinPath } from "@meowbert/shared";
import type { InlineArtifact } from "@meowbert/shared/inline-artifacts";
import { SHOW_CANVAS_TOOL_NAME, showCanvasArgumentsSchema } from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { runCanvasCheck } from "../../canvas/canvas-check.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage, rethrowIfTaskCancelled } from "../utils.js";
import { attachProjectCanvasToRun, readAttachedProjectCanvas } from "./project-canvas-context.js";

const ARTIFACT_TYPES: Record<string, InlineArtifact["type"]> = {
  ".html": "html",
  ".htm": "html",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".avif": "image",
  ".svg": "image",
  ".mmd": "mermaid",
  ".mermaid": "mermaid"
};

interface ResolvedCanvasEntry {
  absolutePath: string;
  rootDir: string;
  relativePath: string;
  canvasId: string | null;
}

function toWebPath(value: string): string {
  return value.split(path.sep).join("/");
}

async function resolveCanvasEntry(ctx: ToolDispatchContext, requestedPath: string): Promise<ResolvedCanvasEntry> {
  const candidate = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(ctx.taskDir, requestedPath);
  const absolutePath = await realpath(candidate).catch(() => {
    throw new Error(`File not found: ${requestedPath}`);
  });
  if (!(await stat(absolutePath)).isFile()) {
    throw new Error(`Not a file: ${requestedPath}`);
  }

  const projectCanvas = readAttachedProjectCanvas(ctx);
  const canvasDir = projectCanvas ? await realpath(projectCanvas.absolutePath).catch(() => null) : null;
  if (projectCanvas && canvasDir && isWithinPath(canvasDir, absolutePath)) {
    return { absolutePath, rootDir: canvasDir, relativePath: toWebPath(path.relative(canvasDir, absolutePath)), canvasId: projectCanvas.id };
  }

  const taskDir = await realpath(ctx.taskDir);
  if (isWithinPath(taskDir, absolutePath)) {
    return { absolutePath, rootDir: taskDir, relativePath: toWebPath(path.relative(taskDir, absolutePath)), canvasId: null };
  }
  throw new Error("The file must be inside the task directory or the project canvas directory.");
}

// Showing an HTML file of the project canvas makes it the canvas entry, so a built dist/index.html
// becomes what the canvas opens with.
async function recordProjectCanvasEntry(ctx: ToolDispatchContext, entry: ResolvedCanvasEntry): Promise<void> {
  if (!entry.canvasId) return;
  await ctx.control.platform.recordProjectCanvasEntry({ canvasId: entry.canvasId, entryPath: entry.relativePath });
  const projectCanvas = readAttachedProjectCanvas(ctx);
  if (projectCanvas) attachProjectCanvasToRun(ctx, { ...projectCanvas, entryPath: entry.relativePath });
}

function buildScreenshotPath(ctx: ToolDispatchContext, callId: string): string {
  return path.join(ctx.taskScratchDir, "canvas-checks", `${callId.replace(/[^A-Za-z0-9_-]/g, "_")}.png`);
}

export async function handleShowCanvas(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SHOW_CANVAS_TOOL_NAME, outputItem.arguments, showCanvasArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const args = parsed.value;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, { inputLabel: args.title ?? args.path });

  try {
    const entry = await resolveCanvasEntry(ctx, args.path.trim());
    const type = ARTIFACT_TYPES[path.extname(entry.absolutePath).toLowerCase()];
    if (!type) {
      return finishBuiltinToolFailure(ctx, execution, "show_canvas accepts HTML, image or Mermaid (.mmd) files.");
    }
    const display = args.display === "panel" ? "panel" : "inline";
    if (type === "html") await recordProjectCanvasEntry(ctx, entry);

    const check = type === "html"
      ? await runCanvasCheck({
          sandbox: ctx.sandbox,
          skillsRootDir: ctx.skillsRootDir,
          workingDir: ctx.taskDir,
          entryPath: entry.absolutePath,
          rootDir: entry.rootDir,
          display,
          screenshotPath: buildScreenshotPath(ctx, outputItem.call_id),
          abortSignal: ctx.cancellationSignal
        })
      : null;
    await ctx.control.emitEvent("artifact", {
      count: 0,
      canvasUpdate: { relativePath: entry.relativePath, canvasId: entry.canvasId, display }
    });

    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: check === null || ("ok" in check && check.ok),
      inline_artifact: {
        type,
        relative_path: entry.relativePath,
        ...(entry.canvasId ? { canvas_id: entry.canvasId } : {}),
        display,
        title: args.title?.trim() || null,
        height: args.height ?? null
      },
      ...(check ? { check } : {})
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to show canvas: ${getErrorMessage(error)}`);
  }
}
