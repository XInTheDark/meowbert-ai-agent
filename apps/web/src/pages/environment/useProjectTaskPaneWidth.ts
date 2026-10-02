import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";

const STORAGE_KEY = "meowbert_project_task_pane_width_v1";
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 260;
const MAX_WIDTH = 560;
const KEYBOARD_STEP = 16;

function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
}

function readStoredWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

// Width of the task list beside the Master conversation, dragged from the divider and remembered across visits.
export function useProjectTaskPaneWidth() {
  const [width, setWidth] = useState(readStoredWidth);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // Ignore storage write failures.
    }
  }, [width]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-split");

    const handleMove = (moveEvent: globalThis.PointerEvent) => setWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    const handleUp = () => {
      document.body.classList.remove("is-resizing-split");
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      handle.removeEventListener("pointercancel", handleUp);
    };
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
    handle.addEventListener("pointercancel", handleUp);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setWidth((current) => clampWidth(current + (event.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP)));
  }

  return {
    width,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    handlePointerDown,
    handleKeyDown,
    reset: () => setWidth(DEFAULT_WIDTH)
  };
}
