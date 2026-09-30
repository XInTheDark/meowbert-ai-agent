import { buildTaskHistorySearchParams } from "@meowbert/shared/task-history-search";
import type { TaskListPagination } from "../../../lib/types";
import {
  RESIZABLE_TASK_COLUMNS,
  TASK_COLUMN_MIN_WIDTHS,
  TASK_LIST_COLUMN_STORAGE_KEY,
  type ResizableTaskColumn,
  type TaskFolderFilter,
  type TaskScopeFilter,
  type TaskSortBy,
  type TaskSortDir,
  type TaskStatusFilter,
  type TaskTypeFilter
} from "./environmentOverviewTypes";

export function readStoredTaskColumnWidths(): Record<ResizableTaskColumn, number> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(TASK_LIST_COLUMN_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<ResizableTaskColumn, unknown>>;
    const widths: Partial<Record<ResizableTaskColumn, number>> = {};
    for (const column of RESIZABLE_TASK_COLUMNS) {
      const value = parsed[column];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return null;
      }
      widths[column] = Math.max(Math.round(value), TASK_COLUMN_MIN_WIDTHS[column]);
    }

    return widths as Record<ResizableTaskColumn, number>;
  } catch {
    return null;
  }
}

export function buildTaskListGridTemplate(widths: Record<ResizableTaskColumn, number>): string {
  const clampedWidths = RESIZABLE_TASK_COLUMNS.reduce<Record<ResizableTaskColumn, number>>((result, column) => {
    result[column] = Math.max(Math.round(widths[column]), TASK_COLUMN_MIN_WIDTHS[column]);
    return result;
  }, {} as Record<ResizableTaskColumn, number>);

  return [
    "36px",
    `minmax(${clampedWidths.task}px, 1fr)`,
    `${clampedWidths.status}px`,
    `${clampedWidths.updated}px`,
    `${clampedWidths.created}px`,
    `${clampedWidths.actions}px`
  ].join(" ");
}

export function buildTaskListPath(input: {
  projectId?: string;
  environmentId?: string;
  query: string;
  status: TaskStatusFilter;
  taskType: TaskTypeFilter;
  folderFilter: TaskFolderFilter;
  scope: TaskScopeFilter;
  sortBy: TaskSortBy;
  sortDir: TaskSortDir;
  includePreview?: boolean;
  page: number;
  pageSize: number;
}): string {
  const folderMode = input.folderFilter === "all"
    ? "all"
    : input.folderFilter === "unfiled"
      ? "unfiled"
      : "folder";
  const searchParams = buildTaskHistorySearchParams({
    query: input.query.trim(),
    status: input.status.length > 0 ? input.status : null,
    taskType: input.taskType.length > 0 ? input.taskType : null,
    scope: input.scope,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
    folderMode,
    folderId: folderMode === "folder" ? input.folderFilter : null,
    includePreview: input.includePreview ?? true,
    page: input.page,
    pageSize: input.pageSize
  });
  const projectId = input.projectId ?? input.environmentId;
  if (!projectId) {
    throw new Error("buildTaskListPath requires a projectId or environmentId");
  }
  return `/api/projects/${projectId}/tasks?${searchParams.toString()}`;
}

export function createEmptyTaskListPagination(page: number, pageSize: number): TaskListPagination {
  return {
    page,
    pageSize,
    hasPreviousPage: page > 1,
    hasNextPage: false,
    totalItems: null,
    totalPages: null
  };
}

export function buildPublicTaskShareUrl(publicPath: string, publicBaseUrl: string): string {
  return new URL(publicPath, publicBaseUrl).toString();
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to legacy fallback.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}
