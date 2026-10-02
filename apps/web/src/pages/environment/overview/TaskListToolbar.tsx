import { useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_TASK_HISTORY_SCOPE,
  DEFAULT_TASK_HISTORY_SORT_BY,
  DEFAULT_TASK_HISTORY_SORT_DIR,
  TASK_HISTORY_SCOPE_VALUES,
  TASK_HISTORY_STATUS_VALUES,
  TASK_HISTORY_TASK_TYPE_VALUES,
  type TaskHistoryScope,
  type TaskHistorySortBy,
  type TaskHistorySortDir,
  type TaskHistoryStatusValue,
  type TaskHistoryTaskType
} from "@meowbert/shared/task-history-search";
import { ArrowUpDown, SlidersHorizontal } from "lucide-react";
import type { TaskFolderSummary } from "../../../lib/types";
import { formatTaskTypeLabel } from "../../../lib/utils";
import { TaskSearchInputBar } from "../../../components/search/TaskSearchInputBar";
import { DEFAULT_TASK_FOLDER_VIEW_MODE, type TaskFolderFilter, type TaskFolderViewMode } from "./projectOverviewTypes";
import { buildTaskFolderOptions } from "./taskFolderTree";
import { TaskFilterMultiSelectDropdown, type TaskFilterMultiSelectOption } from "./TaskFilterMultiSelectDropdown";

const STATUS_LABELS: Record<TaskHistoryStatusValue, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  awaiting_input: "Awaiting Input",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled"
};

const SCOPE_LABELS: Record<TaskHistoryScope, string> = {
  active: "Active",
  trashed: "Trash",
  all: "All Scopes"
};

export const TASK_SEARCH_STATUS_OPTIONS: TaskFilterMultiSelectOption[] = TASK_HISTORY_STATUS_VALUES.map((status) => ({
  value: status,
  label: STATUS_LABELS[status]
}));

export const TASK_SEARCH_TASK_TYPE_OPTIONS: TaskFilterMultiSelectOption[] = TASK_HISTORY_TASK_TYPE_VALUES.map((taskType) => ({
  value: taskType,
  label: formatTaskTypeLabel(taskType)
}));

function countActiveFilters(input: {
  status: TaskHistoryStatusValue[];
  scope: TaskHistoryScope;
  taskType: TaskHistoryTaskType[];
  folderFilter: TaskFolderFilter;
  sortBy: TaskHistorySortBy;
  sortDir: TaskHistorySortDir;
  folderViewMode: TaskFolderViewMode;
  includePreview: boolean;
}): number {
  return input.status.length
    + input.taskType.length
    + (input.scope !== DEFAULT_TASK_HISTORY_SCOPE ? 1 : 0)
    + (input.folderFilter !== "all" ? 1 : 0)
    + (input.sortBy !== DEFAULT_TASK_HISTORY_SORT_BY ? 1 : 0)
    + (input.sortDir !== DEFAULT_TASK_HISTORY_SORT_DIR ? 1 : 0)
    + (input.folderViewMode !== DEFAULT_TASK_FOLDER_VIEW_MODE ? 1 : 0)
    + (!input.includePreview ? 1 : 0);
}

export function summarizeTaskSearchMultiSelect(labels: string[], fallback: string, pluralLabel: string): string {
  if (labels.length === 0) {
    return fallback;
  }

  if (labels.length <= 2) {
    return labels.join(", ");
  }

  return `${labels.length} ${pluralLabel}`;
}

interface TaskListToolbarProps {
  searchDraft: string;
  statusFilter: TaskHistoryStatusValue[];
  scopeFilter: TaskHistoryScope;
  taskTypeFilter: TaskHistoryTaskType[];
  folderFilter: TaskFolderFilter;
  folders: TaskFolderSummary[];
  sortBy: TaskHistorySortBy;
  sortDir: TaskHistorySortDir;
  folderViewMode: TaskFolderViewMode;
  includePreview: boolean;
  extraActions?: ReactNode;
  onSearchDraftChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusFilterChange: (value: TaskHistoryStatusValue[]) => void;
  onScopeFilterChange: (value: TaskHistoryScope) => void;
  onTaskTypeFilterChange: (value: TaskHistoryTaskType[]) => void;
  onFolderFilterChange: (value: TaskFolderFilter) => void;
  onSortByChange: (value: TaskHistorySortBy) => void;
  onSortDirToggle: () => void;
  onFolderViewModeChange: (value: TaskFolderViewMode) => void;
  onIncludePreviewChange: (value: boolean) => void;
  onResetFilters: () => void;
}

export function TaskListToolbar(props: TaskListToolbarProps) {
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const activeFilterCount = useMemo(() => countActiveFilters({
    status: props.statusFilter,
    scope: props.scopeFilter,
    taskType: props.taskTypeFilter,
    folderFilter: props.folderFilter,
    sortBy: props.sortBy,
    sortDir: props.sortDir,
    folderViewMode: props.folderViewMode,
    includePreview: props.includePreview
  }), [props.folderFilter, props.folderViewMode, props.includePreview, props.scopeFilter, props.sortBy, props.sortDir, props.statusFilter, props.taskTypeFilter]);
  const selectedStatusLabels = TASK_SEARCH_STATUS_OPTIONS
    .filter((option) => props.statusFilter.includes(option.value as TaskHistoryStatusValue))
    .map((option) => option.label);
  const selectedTaskTypeLabels = TASK_SEARCH_TASK_TYPE_OPTIONS
    .filter((option) => props.taskTypeFilter.includes(option.value as TaskHistoryTaskType))
    .map((option) => option.label);
  const folderOptions = buildTaskFolderOptions(props.folders);

  return (
    <div className="task-toolbar-shell">
      <div className="task-toolbar">
        <TaskSearchInputBar
          value={props.searchDraft}
          onChange={props.onSearchDraftChange}
          onSubmit={props.onSearchSubmit}
          placeholder="Search tasks and conversation history..."
        />

        <div className="task-toolbar-actions">
          <button
            type="button"
            className={`btn ghost task-filter-toggle ${isFiltersOpen ? "is-open" : ""}`}
            onClick={() => setIsFiltersOpen((value) => !value)}
            title="Options"
          >
            <SlidersHorizontal size={16} />
            <span>Options</span>
            {activeFilterCount > 0 ? <span className="task-filter-badge">{activeFilterCount}</span> : null}
          </button>
          {props.extraActions}
        </div>
      </div>

      {isFiltersOpen ? (
        <div className="task-filter-panel">
          <div className="task-filter-grid">
            <label className="task-filter-group">
              <span className="task-filter-label">View</span>
              <select
                value={props.folderViewMode}
                onChange={(event) => props.onFolderViewModeChange(event.target.value as TaskFolderViewMode)}
                className="toolbar-select"
              >
                <option value="mixedTree">Mixed Tree</option>
                <option value="foldersFirst">Folders First</option>
                <option value="flatTasks">Flat Tasks</option>
              </select>
            </label>

            <TaskFilterMultiSelectDropdown
              label="Status"
              placeholder="All Statuses"
              options={TASK_SEARCH_STATUS_OPTIONS}
              selectedValues={props.statusFilter}
              onChange={(value) => props.onStatusFilterChange(value as TaskHistoryStatusValue[])}
              summaryText={summarizeTaskSearchMultiSelect(selectedStatusLabels, "All Statuses", "statuses")}
            />

            <TaskFilterMultiSelectDropdown
              label="Type"
              placeholder="All Types"
              options={TASK_SEARCH_TASK_TYPE_OPTIONS}
              selectedValues={props.taskTypeFilter}
              onChange={(value) => props.onTaskTypeFilterChange(value as TaskHistoryTaskType[])}
              summaryText={summarizeTaskSearchMultiSelect(selectedTaskTypeLabels, "All Types", "types")}
            />

            <label className="task-filter-group">
              <span className="task-filter-label">Scope</span>
              <select
                value={props.scopeFilter}
                onChange={(event) => props.onScopeFilterChange(event.target.value as TaskHistoryScope)}
                className="toolbar-select"
              >
                {TASK_HISTORY_SCOPE_VALUES.map((scope) => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}
              </select>
            </label>

            <label className="task-filter-group">
              <span className="task-filter-label">Folder</span>
              <select
                value={props.folderFilter}
                onChange={(event) => props.onFolderFilterChange(event.target.value as TaskFolderFilter)}
                className="toolbar-select"
              >
                {folderOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="task-filter-group">
              <span className="task-filter-label">Sort by</span>
              <select
                value={props.sortBy}
                onChange={(event) => props.onSortByChange(event.target.value as TaskHistorySortBy)}
                className="toolbar-select"
              >
                <option value="relevance">Relevance</option>
                <option value="updated_at">Updated</option>
                <option value="created_at">Created</option>
                <option value="title">Title</option>
                <option value="status">Status</option>
              </select>
            </label>

            <div className="task-filter-group">
              <span className="task-filter-label">Direction</span>
              <button
                type="button"
                className="btn ghost task-sort-direction-btn"
                onClick={props.onSortDirToggle}
                disabled={props.sortBy === "relevance"}
              >
                <ArrowUpDown size={16} style={{ transform: props.sortDir === "asc" ? "rotate(180deg)" : "none" }} />
                <span>{props.sortDir === "asc" ? "Ascending" : "Descending"}</span>
              </button>
            </div>

            <label className="task-filter-group task-filter-checkbox-group">
              <span className="task-filter-label">Preview</span>
              <span className="task-filter-checkbox-row">
                <input
                  type="checkbox"
                  checked={props.includePreview}
                  onChange={(event) => props.onIncludePreviewChange(event.target.checked)}
                />
                <span>Show match preview</span>
              </span>
            </label>
          </div>

          <div className="task-filter-panel-footer">
            <button
              type="button"
              className="btn ghost task-filter-reset"
              onClick={props.onResetFilters}
              disabled={activeFilterCount === 0}
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
