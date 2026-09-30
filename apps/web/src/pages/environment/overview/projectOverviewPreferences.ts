import {
  DEFAULT_TASK_FOLDER_VIEW_MODE,
  TASK_FOLDER_COLLAPSE_STORAGE_KEY_PREFIX,
  TASK_FOLDER_VIEW_MODE_STORAGE_KEY_PREFIX,
  type TaskFolderViewMode
} from "./projectOverviewTypes";

export function readCollapsedTaskFolders(projectId: string | null | undefined): Set<string> {
  if (!projectId || typeof window === "undefined") return new Set();
  const raw = window.localStorage.getItem(`${TASK_FOLDER_COLLAPSE_STORAGE_KEY_PREFIX}:${projectId}`);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function writeCollapsedTaskFolders(
  projectId: string | null | undefined,
  collapsedFolderIds: Set<string>
): void {
  if (!projectId || typeof window === "undefined") return;
  window.localStorage.setItem(
    `${TASK_FOLDER_COLLAPSE_STORAGE_KEY_PREFIX}:${projectId}`,
    JSON.stringify([...collapsedFolderIds])
  );
}

export function readTaskFolderViewMode(projectId: string | null | undefined): TaskFolderViewMode {
  if (!projectId || typeof window === "undefined") return DEFAULT_TASK_FOLDER_VIEW_MODE;
  const value = window.localStorage.getItem(`${TASK_FOLDER_VIEW_MODE_STORAGE_KEY_PREFIX}:${projectId}`);
  return value === "mixedTree" || value === "foldersFirst" || value === "flatTasks"
    ? value
    : DEFAULT_TASK_FOLDER_VIEW_MODE;
}

export function writeTaskFolderViewMode(
  projectId: string | null | undefined,
  viewMode: TaskFolderViewMode
): void {
  if (!projectId || typeof window === "undefined") return;
  window.localStorage.setItem(`${TASK_FOLDER_VIEW_MODE_STORAGE_KEY_PREFIX}:${projectId}`, viewMode);
}
