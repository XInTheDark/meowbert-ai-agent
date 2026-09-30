import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, SlidersHorizontal } from "lucide-react";
import {
  buildTaskHistorySearchParams,
  TASK_HISTORY_SCOPE_VALUES,
  type TaskHistoryScope,
  type TaskHistorySortBy,
  type TaskHistorySortDir,
  type TaskHistoryStatusValue,
  type TaskHistoryTaskType
} from "@meowbert/shared/task-history-search";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { InlineProgressBar } from "../../components/InlineProgressBar";
import { TaskSearchInputBar } from "../../components/search/TaskSearchInputBar";
import { TaskSearchPreview } from "../../components/search/TaskSearchPreview";
import { TaskStatusBadge } from "../../components/tasks/TaskStatusBadge";
import type { GlobalTaskSearchResponse, GlobalTaskSearchResult } from "../../lib/types";
import { formatRelative, formatTaskTypeLabel } from "../../lib/utils";
import {
  TASK_SEARCH_STATUS_OPTIONS,
  TASK_SEARCH_TASK_TYPE_OPTIONS,
  summarizeTaskSearchMultiSelect
} from "../environment/overview/TaskListToolbar";
import { TaskFilterMultiSelectDropdown, type TaskFilterMultiSelectOption } from "../environment/overview/TaskFilterMultiSelectDropdown";

const SCOPE_LABELS: Record<TaskHistoryScope, string> = {
  active: "Active",
  trashed: "Trash",
  all: "All Scopes"
};

function buildGlobalTaskSearchPath(input: {
  query: string;
  workspaceIds: string[];
  status: TaskHistoryStatusValue[];
  taskType: TaskHistoryTaskType[];
  scope: TaskHistoryScope;
  sortBy: TaskHistorySortBy;
  sortDir: TaskHistorySortDir;
  includePreview: boolean;
  page: number;
  pageSize: number;
}): string {
  const params = buildTaskHistorySearchParams({
    query: input.query,
    status: input.status.length > 0 ? input.status : null,
    taskType: input.taskType.length > 0 ? input.taskType : null,
    scope: input.scope,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
    folderMode: "all",
    folderId: null,
    includePreview: input.includePreview,
    page: input.page,
    pageSize: input.pageSize
  });

  for (const workspaceId of input.workspaceIds) {
    params.append("workspaceId", workspaceId);
  }

  return `/api/search/tasks?${params.toString()}`;
}

function GlobalSearchResultRow(props: {
  item: GlobalTaskSearchResult;
  onOpen: (item: GlobalTaskSearchResult) => void;
}) {
  return (
    <button type="button" className="global-search-result" onClick={() => props.onOpen(props.item)}>
      <span className="global-search-result-main">
        <span className="global-search-title">{props.item.title || "Untitled Task"}</span>
        <span className="global-search-meta">
          {props.item.workspace_name} / {props.item.project_name}
          {props.item.task_type && props.item.task_type !== "standard" ? ` · ${formatTaskTypeLabel(props.item.task_type)}` : ""}
          {" · updated "}
          {formatRelative(props.item.updated_at)}
        </span>
        <TaskSearchPreview preview={props.item.searchPreview} />
      </span>
      <TaskStatusBadge status={props.item.status} />
    </button>
  );
}

export function WorkspaceGlobalSearchPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, workspaces } = workspaceApp;
  const navigate = useNavigate();
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskHistoryStatusValue[]>([]);
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskHistoryTaskType[]>([]);
  const [scopeFilter, setScopeFilter] = useState<TaskHistoryScope>("active");
  const [sortBy, setSortBy] = useState<TaskHistorySortBy>("updated_at");
  const [sortDir, setSortDir] = useState<TaskHistorySortDir>("desc");
  const [includePreview, setIncludePreview] = useState(true);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<GlobalTaskSearchResult[]>([]);
  const [pagination, setPagination] = useState<GlobalTaskSearchResponse["pagination"]>({
    page: 1,
    pageSize: 25,
    hasPreviousPage: false,
    hasNextPage: false,
    totalItems: null,
    totalPages: null
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const workspaceOptions: TaskFilterMultiSelectOption[] = useMemo(
    () => workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
    [workspaces]
  );
  const selectedWorkspaceLabels = workspaceOptions
    .filter((option) => workspaceFilter.includes(option.value))
    .map((option) => option.label);
  const selectedStatusLabels = TASK_SEARCH_STATUS_OPTIONS
    .filter((option) => statusFilter.includes(option.value as TaskHistoryStatusValue))
    .map((option) => option.label);
  const selectedTaskTypeLabels = TASK_SEARCH_TASK_TYPE_OPTIONS
    .filter((option) => taskTypeFilter.includes(option.value as TaskHistoryTaskType))
    .map((option) => option.label);
  const activeFilterCount = workspaceFilter.length
    + statusFilter.length
    + taskTypeFilter.length
    + (scopeFilter !== "active" ? 1 : 0)
    + (sortBy !== "updated_at" ? 1 : 0)
    + (sortDir !== "desc" ? 1 : 0)
    + (!includePreview ? 1 : 0);

  useEffect(() => {
    if (!searchTerm) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    let cancelled = false;
    const path = buildGlobalTaskSearchPath({
      query: searchTerm,
      workspaceIds: workspaceFilter,
      status: statusFilter,
      taskType: taskTypeFilter,
      scope: scopeFilter,
      sortBy,
      sortDir,
      includePreview,
      page,
      pageSize: pagination.pageSize
    });

    setIsLoading(true);
    setError(null);
    api.get<GlobalTaskSearchResponse>(path)
      .then((response) => {
        if (!cancelled) {
          setResults(response.items);
          setPagination(response.pagination);
          setHasSearched(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setResults([]);
          setError(err instanceof Error ? err.message : String(err));
          setHasSearched(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, includePreview, page, pagination.pageSize, scopeFilter, searchTerm, sortBy, sortDir, statusFilter, taskTypeFilter, workspaceFilter]);

  function submitSearch(): void {
    setSearchTerm(searchDraft.trim());
    setPage(1);
  }

  function resetFilters(): void {
    setWorkspaceFilter([]);
    setStatusFilter([]);
    setTaskTypeFilter([]);
    setScopeFilter("active");
    setSortBy("updated_at");
    setSortDir("desc");
    setIncludePreview(true);
    setPage(1);
  }

  function openResult(item: GlobalTaskSearchResult): void {
    workspaceApp.api.primeGet?.(`/api/projects/${item.project_id}`, {
      id: item.project_id,
      workspace_id: item.workspace_id,
      name: item.project_name,
      status: "active"
    });
    workspaceApp.api.primeGet?.(`/api/tasks/${item.id}?messageDetail=none`, { task: item });
    navigate(`/app/${item.workspace_id}/projects/${item.project_id}/tasks/${item.id}`);
  }

  return (
    <section className="workbench-page">
      <article className="workbench-panel padded">
        <div className="section-head" style={{ marginBottom: "1rem" }}>
          <h3 style={{ margin: 0 }}>Search</h3>
        </div>

        <div className="task-toolbar-shell">
          <div className="task-toolbar">
            <TaskSearchInputBar
              value={searchDraft}
              onChange={setSearchDraft}
              onSubmit={submitSearch}
              placeholder="Search tasks across workspaces..."
            />
            <div className="task-toolbar-actions">
              <button
                type="button"
                className={`btn ghost task-filter-toggle ${isFiltersOpen ? "is-open" : ""}`}
                onClick={() => setIsFiltersOpen((value) => !value)}
              >
                <SlidersHorizontal size={16} />
                <span>Filters</span>
                {activeFilterCount > 0 ? <span className="task-filter-badge">{activeFilterCount}</span> : null}
              </button>
            </div>
          </div>

          {isFiltersOpen ? (
            <div className="task-filter-panel">
              <div className="task-filter-grid">
                <TaskFilterMultiSelectDropdown
                  label="Workspace"
                  placeholder="All Workspaces"
                  options={workspaceOptions}
                  selectedValues={workspaceFilter}
                  onChange={(value) => { setWorkspaceFilter(value); setPage(1); }}
                  summaryText={summarizeTaskSearchMultiSelect(selectedWorkspaceLabels, "All Workspaces", "workspaces")}
                />
                <TaskFilterMultiSelectDropdown
                  label="Status"
                  placeholder="All Statuses"
                  options={TASK_SEARCH_STATUS_OPTIONS}
                  selectedValues={statusFilter}
                  onChange={(value) => { setStatusFilter(value as TaskHistoryStatusValue[]); setPage(1); }}
                  summaryText={summarizeTaskSearchMultiSelect(selectedStatusLabels, "All Statuses", "statuses")}
                />
                <TaskFilterMultiSelectDropdown
                  label="Type"
                  placeholder="All Types"
                  options={TASK_SEARCH_TASK_TYPE_OPTIONS}
                  selectedValues={taskTypeFilter}
                  onChange={(value) => { setTaskTypeFilter(value as TaskHistoryTaskType[]); setPage(1); }}
                  summaryText={summarizeTaskSearchMultiSelect(selectedTaskTypeLabels, "All Types", "types")}
                />
                <label className="task-filter-group">
                  <span className="task-filter-label">Scope</span>
                  <select value={scopeFilter} onChange={(event) => { setScopeFilter(event.target.value as TaskHistoryScope); setPage(1); }} className="toolbar-select">
                    {TASK_HISTORY_SCOPE_VALUES.map((scope) => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}
                  </select>
                </label>
                <label className="task-filter-group">
                  <span className="task-filter-label">Sort by</span>
                  <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as TaskHistorySortBy); setPage(1); }} className="toolbar-select">
                    <option value="updated_at">Updated</option>
                    <option value="created_at">Created</option>
                    <option value="title">Title</option>
                    <option value="status">Status</option>
                  </select>
                </label>
                <div className="task-filter-group">
                  <span className="task-filter-label">Direction</span>
                  <button type="button" className="btn ghost task-sort-direction-btn" onClick={() => { setSortDir((value) => value === "asc" ? "desc" : "asc"); setPage(1); }}>
                    <ArrowUpDown size={16} style={{ transform: sortDir === "asc" ? "rotate(180deg)" : "none" }} />
                    <span>{sortDir === "asc" ? "Ascending" : "Descending"}</span>
                  </button>
                </div>
                <label className="task-filter-group task-filter-checkbox-group">
                  <span className="task-filter-label">Preview</span>
                  <span className="task-filter-checkbox-row">
                    <input type="checkbox" checked={includePreview} onChange={(event) => { setIncludePreview(event.target.checked); setPage(1); }} />
                    <span>Show match preview</span>
                  </span>
                </label>
              </div>
              <div className="task-filter-panel-footer">
                <button type="button" className="btn ghost task-filter-reset" onClick={resetFilters} disabled={activeFilterCount === 0}>
                  Reset filters
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {error ? <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div> : null}
        {isLoading ? <InlineProgressBar pin="top" /> : null}
        {!isLoading && !hasSearched ? <div className="task-list-empty">Search tasks by title or conversation text.</div> : null}
        {!isLoading && hasSearched && results.length === 0 ? <div className="task-list-empty">No tasks match the current filters.</div> : null}
        {results.length > 0 ? (
          <div className="global-search-results">
            {results.map((item) => <GlobalSearchResultRow key={item.id} item={item} onOpen={openResult} />)}
          </div>
        ) : null}

        <div className="task-pagination task-pagination-spread">
          <button className="btn ghost" disabled={!pagination.hasPreviousPage || isLoading} onClick={() => setPage((value) => value - 1)}>
            Previous
          </button>
          <span className="muted-text" style={{ fontSize: "0.9rem" }}>
            Page {results.length > 0 || page > 1 || pagination.hasNextPage ? page : 0}
          </span>
          <button className="btn ghost" disabled={!pagination.hasNextPage || isLoading} onClick={() => setPage((value) => value + 1)}>
            Next
          </button>
        </div>
      </article>
    </section>
  );
}
