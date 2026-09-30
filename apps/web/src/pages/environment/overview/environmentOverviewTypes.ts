import type {
  TaskHistoryScope,
  TaskHistorySortBy,
  TaskHistorySortDir,
  TaskHistoryStatusValue,
  TaskHistoryTaskType
} from "@meowbert/shared/task-history-search";

export type TaskScopeFilter = TaskHistoryScope;
export type TaskSortBy = TaskHistorySortBy;
export type TaskSortDir = TaskHistorySortDir;
export type TaskTypeFilter = TaskHistoryTaskType[];
export type ResizableTaskColumn = "task" | "status" | "updated" | "created" | "actions";
export type TaskStatusFilter = TaskHistoryStatusValue[];
export type TaskFolderFilter = "all" | "unfiled" | string;
export type TaskFolderViewMode = "mixedTree" | "foldersFirst" | "flatTasks";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = Number(PAGE_SIZE_OPTIONS[0]);
export const TASK_LIST_COLUMN_STORAGE_KEY = "meowbert_task_list_columns_v2";
export const TASK_FOLDER_COLLAPSE_STORAGE_KEY_PREFIX = "meowbert_task_folder_collapsed_v1";
export const TASK_FOLDER_VIEW_MODE_STORAGE_KEY_PREFIX = "meowbert_task_folder_view_mode_v1";
export const DEFAULT_TASK_FOLDER_VIEW_MODE: TaskFolderViewMode = "mixedTree";
export const RESIZABLE_TASK_COLUMNS: readonly ResizableTaskColumn[] = [
  "task",
  "status",
  "updated",
  "created",
  "actions"
];
export const TASK_COLUMN_MIN_WIDTHS: Record<ResizableTaskColumn, number> = {
  task: 240,
  status: 90,
  updated: 88,
  created: 88,
  actions: 84
};
export const DEFAULT_TASK_COLUMN_WIDTHS: Record<ResizableTaskColumn, number> = {
  task: 320,
  status: 132,
  updated: 120,
  created: 120,
  actions: 96
};
