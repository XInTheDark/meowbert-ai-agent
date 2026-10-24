import type { ToolDispatchContext } from "../types.js";

export interface AttachedProjectCanvas {
  id: string;
  absolutePath: string;
  entryPath: string;
}

// The run's shell environment already carries the attached canvas (set at startup, or when the
// agent creates one mid-run), so it doubles as the run's record of which canvas is attached.
export function attachProjectCanvasToRun(ctx: Pick<ToolDispatchContext, "shellEnvOverrides">, canvas: AttachedProjectCanvas): void {
  ctx.shellEnvOverrides.CANVAS_DIR = canvas.absolutePath;
  ctx.shellEnvOverrides.MEOWBERT_CANVAS_DIR = canvas.absolutePath;
  ctx.shellEnvOverrides.CANVAS_ID = canvas.id;
  ctx.shellEnvOverrides.CANVAS_ENTRY_PATH = canvas.entryPath;
}

export function readAttachedProjectCanvas(ctx: Pick<ToolDispatchContext, "shellEnvOverrides">): AttachedProjectCanvas | null {
  const id = ctx.shellEnvOverrides.CANVAS_ID;
  const absolutePath = ctx.shellEnvOverrides.CANVAS_DIR;
  if (!id || !absolutePath) {
    return null;
  }
  return { id, absolutePath, entryPath: ctx.shellEnvOverrides.CANVAS_ENTRY_PATH ?? "index.html" };
}
