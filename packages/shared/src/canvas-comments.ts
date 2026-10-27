import type { CanvasElementSelection } from "./canvas-frame.js";

export interface CanvasComment {
  id: string;
  relativePath: string;
  element: CanvasElementSelection;
  body: string;
  resolved: boolean;
  createdAt: string;
}
