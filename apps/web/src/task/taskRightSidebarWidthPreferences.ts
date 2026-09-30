const TASK_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "meowbert_task_right_sidebar_width";

export const DEFAULT_TASK_RIGHT_SIDEBAR_WIDTH = 420;
export const MIN_TASK_RIGHT_SIDEBAR_WIDTH = 320;
export const MAX_TASK_RIGHT_SIDEBAR_WIDTH = 760;

function clampTaskRightSidebarWidth(value: number): number {
  return Math.min(Math.max(value, MIN_TASK_RIGHT_SIDEBAR_WIDTH), MAX_TASK_RIGHT_SIDEBAR_WIDTH);
}

export function readTaskRightSidebarWidthPreference(
  fallback: number = DEFAULT_TASK_RIGHT_SIDEBAR_WIDTH
): number {
  if (typeof window === "undefined") {
    return clampTaskRightSidebarWidth(fallback);
  }

  try {
    const rawValue = window.localStorage.getItem(TASK_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY);
    if (!rawValue) {
      return clampTaskRightSidebarWidth(fallback);
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isFinite(parsed)) {
      return clampTaskRightSidebarWidth(parsed);
    }
  } catch {
    return clampTaskRightSidebarWidth(fallback);
  }

  return clampTaskRightSidebarWidth(fallback);
}

export function writeTaskRightSidebarWidthPreference(width: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(TASK_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, `${clampTaskRightSidebarWidth(width)}`);
  } catch {
    // Ignore localStorage write failures so resizing still works for the current session.
  }
}
