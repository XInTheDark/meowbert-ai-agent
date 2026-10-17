import type { CanvasFrameError } from "@meowbert/shared/canvas-frame";
import type { InlineArtifact } from "@meowbert/shared/inline-artifacts";

/** Something the canvas viewer can show: a task file or a page of a project canvas. */
export interface CanvasView {
  type: InlineArtifact["type"];
  relativePath: string;
  canvasId: string | null;
  title: string | null;
  display: InlineArtifact["display"];
  height: number | null;
}

export function canvasViewFromArtifact(artifact: InlineArtifact): CanvasView {
  return {
    type: artifact.type,
    relativePath: artifact.relativePath,
    canvasId: artifact.canvasId,
    title: artifact.title,
    display: artifact.display,
    height: artifact.height
  };
}

export function getCanvasViewKey(view: Pick<CanvasView, "canvasId" | "relativePath">): string {
  return view.canvasId ? `canvas:${view.canvasId}:${view.relativePath}` : `task:${view.relativePath}`;
}

export function getCanvasViewTitle(view: Pick<CanvasView, "title" | "relativePath">): string {
  return view.title ?? view.relativePath.split("/").filter(Boolean).pop() ?? "Canvas";
}

// A project canvas keeps one storage across its pages and tasks; a task page keeps its own.
export function getCanvasStorageKey(view: Pick<CanvasView, "canvasId" | "relativePath">, taskId: string | null): string {
  return view.canvasId ? `canvas:${view.canvasId}` : `task:${taskId ?? "public"}:${view.relativePath}`;
}

export function buildCanvasFixPrompt(view: Pick<CanvasView, "relativePath">, errors: CanvasFrameError[]): string {
  const lines = errors.slice(0, 10).map((error) => {
    const location = error.source ? ` (${error.source}${error.line ? `:${error.line}` : ""})` : "";
    return `- ${error.message}${location}`;
  });
  return [`The canvas \`${view.relativePath}\` shows these errors in my browser:`, ...lines, "", "Please fix them."].join("\n");
}
