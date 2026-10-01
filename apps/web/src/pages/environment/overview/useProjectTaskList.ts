import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import { API_CACHE_TTLS } from "../../../lib/api-cache";
import type { TaskListPagination, TaskListResponse, TaskSummary } from "../../../lib/types";
import {
  DEFAULT_PAGE_SIZE,
  type TaskFolderFilter,
  type TaskScopeFilter,
  type TaskSortBy,
  type TaskSortDir,
  type TaskStatusFilter,
  type TaskTypeFilter
} from "./projectOverviewTypes";
import { buildTaskListPath, createEmptyTaskListPagination } from "./projectOverviewUtils";

function useProjectTaskFilters(activeProjectId: string | null | undefined, initialSearch: string) {
  const [searchDraft, setSearchDraft] = useState(initialSearch);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>([]);
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>([]);
  const [scopeFilter, setScopeFilter] = useState<TaskScopeFilter>("active");
  const [folderFilter, setFolderFilter] = useState<TaskFolderFilter>("all");
  const [sortBy, setSortBy] = useState<TaskSortBy>("relevance");
  const [sortDir, setSortDir] = useState<TaskSortDir>("desc");
  const [includePreview, setIncludePreview] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setSearchDraft(initialSearch);
    setSearchTerm(initialSearch);
    setStatusFilter([]);
    setTaskTypeFilter([]);
    setScopeFilter("active");
    setFolderFilter("all");
    setSortBy("relevance");
    setSortDir("desc");
    setIncludePreview(true);
    setPage(1);
    setPageSize(DEFAULT_PAGE_SIZE);
  }, [activeProjectId, initialSearch]);

  function submitTaskSearch(): void {
    setSearchTerm(searchDraft.trim());
    setPage(1);
  }

  return {
    searchDraft,
    setSearchDraft,
    searchTerm,
    statusFilter,
    setStatusFilter,
    taskTypeFilter,
    setTaskTypeFilter,
    scopeFilter,
    setScopeFilter,
    folderFilter,
    setFolderFilter,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    includePreview,
    setIncludePreview,
    page,
    setPage,
    pageSize,
    setPageSize,
    submitTaskSearch
  };
}

function useProjectTaskListData(
  api: ApiClient,
  activeProjectId: string | null | undefined,
  filters: ReturnType<typeof useProjectTaskFilters>,
  refreshNonce: number
) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [pagination, setPagination] = useState<TaskListPagination>(() => (
    createEmptyTaskListPagination(1, DEFAULT_PAGE_SIZE)
  ));
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedTaskList, setHasLoadedTaskList] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    setHasLoadedTaskList(false);
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setTasks([]);
      setPagination(createEmptyTaskListPagination(1, filters.pageSize));
      setHasLoadedTaskList(false);
      return;
    }

    const taskListPath = buildTaskListPath({
      projectId: activeProjectId,
      query: filters.searchTerm,
      status: filters.statusFilter,
      taskType: filters.taskTypeFilter,
      folderFilter: filters.folderFilter,
      scope: filters.scopeFilter,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
      includePreview: filters.includePreview,
      page: filters.page,
      pageSize: filters.pageSize
    });
    const cached = api.cachedGet?.<TaskListResponse>(taskListPath, { ttlMs: API_CACHE_TTLS.taskList });
    if (cached?.data) {
      setTasks(cached.data.items);
      setPagination(cached.data.pagination);
      setHasLoadedTaskList(true);
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void (cached ? cached.promise : api.get<TaskListResponse>(taskListPath))
      .then((response) => {
        if (cancelled) return;
        setTasks(response.items);
        setPagination(response.pagination);
        setHasLoadedTaskList(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setTasks([]);
        setPagination(createEmptyTaskListPagination(filters.page, filters.pageSize));
        setHasLoadedTaskList(true);
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    api,
    filters.searchTerm,
    filters.statusFilter,
    filters.taskTypeFilter,
    filters.folderFilter,
    filters.scopeFilter,
    filters.sortBy,
    filters.sortDir,
    filters.includePreview,
    filters.page,
    filters.pageSize,
    refreshNonce
  ]);

  return { tasks, pagination, isLoading, hasLoadedTaskList, loadError, setLoadError, setHasLoadedTaskList };
}

export function useProjectTaskList(api: ApiClient, activeProjectId: string | null | undefined, initialSearch = "") {
  const filters = useProjectTaskFilters(activeProjectId, initialSearch);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const data = useProjectTaskListData(api, activeProjectId, filters, refreshNonce);

  useEffect(() => {
    if (!activeProjectId) return;
    void api.prefetchGet?.(`/api/projects/${activeProjectId}`, { ttlMs: API_CACHE_TTLS.workspaceMetadata }).catch(() => {});
  }, [activeProjectId, api]);

  function prefetchTaskRoute(task: TaskSummary): void {
    if (!activeProjectId) return;
    void api.prefetchGet?.(`/api/tasks/${task.id}?messageDetail=none`, { ttlMs: API_CACHE_TTLS.taskDetail }).catch(() => {});
    void api.prefetchGet?.(`/api/tasks/${task.id}/conversation?limit=50`, { ttlMs: API_CACHE_TTLS.short }).catch(() => {});
  }

  return { ...filters, ...data, refreshNonce, setRefreshNonce, prefetchTaskRoute };
}
