const TASK_MESSAGE_OUTLINE_OPEN_STORAGE_KEY = "meowbert_task_message_outline_open";

export function readTaskMessageOutlineOpenPreference(fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawValue = window.localStorage.getItem(TASK_MESSAGE_OUTLINE_OPEN_STORAGE_KEY);
    if (rawValue === "1") {
      return true;
    }
    if (rawValue === "0") {
      return false;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function writeTaskMessageOutlineOpenPreference(isOpen: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(TASK_MESSAGE_OUTLINE_OPEN_STORAGE_KEY, isOpen ? "1" : "0");
  } catch {
    // Ignore localStorage write failures so the UI still works.
  }
}
