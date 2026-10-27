import { createContext, useContext } from "react";
import type { CanvasView } from "./canvasViews";
import type { CanvasCommentClient } from "./canvasCommentClient";

/** What a page provides to the canvas views inside it: where files load from and what they can do. */
export interface CanvasHost {
  taskId: string | null;
  resolveSource: (view: CanvasView) => { src: string; srcKey: string } | null;
  reloadTokenFor: (view: CanvasView) => number;
  openInPanel?: (view: CanvasView) => void;
  sendPrompt?: (prompt: string) => void;
  comments?: CanvasCommentClient;
}

export const CanvasHostContext = createContext<CanvasHost | null>(null);

export function useCanvasHost(): CanvasHost | null {
  return useContext(CanvasHostContext);
}
