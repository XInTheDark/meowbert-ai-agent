import { canvasViewFromArtifact, getCanvasViewKey, type CanvasView } from "../components/canvas/canvasViews";
import type { ProjectCanvasSummary, TaskMessage } from "../lib/types";
import { getTaskInlineArtifact } from "./taskInlineArtifacts";

export function projectCanvasView(canvas: ProjectCanvasSummary): CanvasView {
  return { type: "html", relativePath: canvas.entryPath, canvasId: canvas.id, title: canvas.name, display: "panel", height: null };
}

/** Every HTML canvas this task can open in the panel: its project canvases, then pages it showed, newest first. */
export function listTaskCanvasViews(projectCanvases: ProjectCanvasSummary[], messages: TaskMessage[]): CanvasView[] {
  const byKey = new Map<string, CanvasView>();
  for (const canvas of projectCanvases) byKey.set(getCanvasViewKey(projectCanvasView(canvas)), projectCanvasView(canvas));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const artifact = getTaskInlineArtifact(messages[index]);
    if (artifact?.type !== "html") continue;
    const view = { ...canvasViewFromArtifact(artifact), display: "panel" as const };
    const key = getCanvasViewKey(view);
    if (!byKey.has(key)) byKey.set(key, view);
  }
  return [...byKey.values()];
}
