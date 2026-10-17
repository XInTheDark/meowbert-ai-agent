import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

const STORAGE_KEY = "meowbert:canvas-panel-width";
const MIN_WIDTH = 360;
const MAX_WIDTH = 1800;

function clampWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH));
}

function readStoredWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampWidth(stored);
  } catch {
    // Fall through to the default.
  }
  return clampWidth(window.innerWidth * 0.5);
}

/** Width of the canvas panel beside the conversation, resizable and remembered per device. */
export function useCanvasPanelWidth() {
  const [width, setWidth] = useState(readStoredWidth);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // Not remembered this time.
    }
  }, [width]);

  function beginResize(event: ReactMouseEvent<HTMLDivElement>): void {
    const startX = event.clientX;
    const startWidth = width;
    const handleMove = (moveEvent: MouseEvent) => setWidth(clampWidth(startWidth + startX - moveEvent.clientX));
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.classList.remove("is-resizing-canvas-panel");
    };
    // Iframes swallow mouse events while dragging over them; the class turns their pointer events off.
    document.body.classList.add("is-resizing-canvas-panel");
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  return { width, beginResize };
}
