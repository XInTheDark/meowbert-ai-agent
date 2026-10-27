import type { CanvasComment } from "@meowbert/shared";
import type { CanvasElementSelection } from "@meowbert/shared/canvas-frame";
import { createApiClient } from "../../lib/api";
import type { CanvasView } from "./canvasViews";

export interface CanvasCommentClient {
  list: (view: CanvasView) => Promise<CanvasComment[]>;
  add: (view: CanvasView, element: CanvasElementSelection, body: string) => Promise<CanvasComment>;
  resolve: (view: CanvasView, id: string, resolved: boolean) => Promise<CanvasComment>;
}

export function createCanvasCommentClient(token: string, taskId: string | null): CanvasCommentClient {
  const api = createApiClient(token);
  const scope = (view: CanvasView) => ({
    ...(view.canvasId ? { canvasId: view.canvasId } : { taskId: taskId ?? "" }), relativePath: view.relativePath
  });
  return {
    list: async (view) => (await api.get<{ items: CanvasComment[] }>(`/api/canvas-comments?${new URLSearchParams(scope(view))}`)).items,
    add: async (view, element, body) => (await api.post<{ comment: CanvasComment }>("/api/canvas-comments", { scope: scope(view), element, body })).comment,
    resolve: async (view, id, resolved) => (await api.patch<{ comment: CanvasComment }>(`/api/canvas-comments/${id}`, { scope: scope(view), resolved })).comment
  };
}
