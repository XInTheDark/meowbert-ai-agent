export const LAST_WORKSPACE_KEY = "meowbert_last_workspace";
export const WORKSPACE_NOTIFICATION_POLL_MS = 10_000;

export function loadLastWorkspaceId(): string | null {
  try {
    const value = localStorage.getItem(LAST_WORKSPACE_KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveLastWorkspaceId(workspaceId: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
  } catch {
    // Last workspace is only a convenience fallback for /app.
  }
}

export function extractTaskIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/tasks\/([0-9a-fA-F-]{36})(?:$|[/?#])/);
  return match?.[1] ?? null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable
    || target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
}

export function dispatchDesktopUploadRequest(): void {
  window.dispatchEvent(new CustomEvent("meowbert:request-upload"));
}
