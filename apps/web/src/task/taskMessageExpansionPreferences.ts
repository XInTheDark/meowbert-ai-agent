const TASK_MESSAGE_EXPANSIONS_STORAGE_KEY = "meowbert_expanded_task_messages";
const MAX_PERSISTED_EXPANSIONS = 500;

function readExpandedMessageKeys(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(TASK_MESSAGE_EXPANSIONS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function buildTaskMessageExpansionKey(taskId: string, messageId: string): string {
  return `${taskId}:${messageId}`;
}

export function isTaskMessageExpanded(expansionKey: string | undefined): boolean {
  return expansionKey ? readExpandedMessageKeys().includes(expansionKey) : false;
}

export function persistTaskMessageExpanded(expansionKey: string | undefined, expanded: boolean): void {
  if (!expansionKey || typeof window === "undefined") {
    return;
  }

  try {
    const keys = readExpandedMessageKeys().filter((key) => key !== expansionKey);
    if (expanded) {
      keys.push(expansionKey);
    }
    window.localStorage.setItem(
      TASK_MESSAGE_EXPANSIONS_STORAGE_KEY,
      JSON.stringify(keys.slice(-MAX_PERSISTED_EXPANSIONS))
    );
  } catch {
    // Keep expansion functional for this render when storage is unavailable.
  }
}
