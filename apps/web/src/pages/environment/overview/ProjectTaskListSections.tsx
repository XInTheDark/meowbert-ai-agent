import { useEffect, type ReactNode, type RefObject } from "react";
import type { Project } from "../../../lib/types";
import { TaskListSkeleton } from "../../../components/tasks/TaskListSkeleton";
import { TaskForkDialog } from "../../../components/tasks/TaskForkDialog";
import { TaskFolderMoveDialog } from "./TaskFolderMoveDialog";
import { TaskListToolbar } from "./TaskListToolbar";
import { TaskTreeList } from "./TaskTreeList";
import { isTaskListContentFiltered } from "./taskFolderTree";
import { buildTaskListGridTemplate } from "./projectOverviewUtils";
import type { TaskSortBy } from "./projectOverviewTypes";
import type { ProjectTaskBrowser } from "./useProjectTaskBrowser";

// The building blocks of a project task list, shared by the full Tasks page and the Master side pane.
export interface ProjectTaskListSectionProps {
  project: Project;
  browser: ProjectTaskBrowser;
}

export function ProjectTaskToolbar(props: ProjectTaskListSectionProps & { extraActions?: ReactNode }) {
  const { taskList, folders } = props.browser;
  const resetPage = () => taskList.setPage(1);
  return (
    <TaskListToolbar
      searchDraft={taskList.searchDraft}
      statusFilter={taskList.statusFilter}
      scopeFilter={taskList.scopeFilter}
      taskTypeFilter={taskList.taskTypeFilter}
      folderFilter={taskList.folderFilter}
      folders={folders.taskFolders}
      sortBy={taskList.sortBy}
      sortDir={taskList.sortDir}
      folderViewMode={folders.folderViewMode}
      includePreview={taskList.includePreview}
      extraActions={props.extraActions}
      onSearchDraftChange={taskList.setSearchDraft}
      onSearchSubmit={taskList.submitTaskSearch}
      onStatusFilterChange={(value) => { taskList.setStatusFilter(value); resetPage(); }}
      onScopeFilterChange={(value) => { taskList.setScopeFilter(value); resetPage(); }}
      onTaskTypeFilterChange={(value) => { taskList.setTaskTypeFilter(value); resetPage(); }}
      onFolderFilterChange={(value) => { taskList.setFolderFilter(value); resetPage(); }}
      onSortByChange={(value) => { taskList.setSortBy(value); resetPage(); }}
      onSortDirToggle={() => { taskList.setSortDir((value) => value === "asc" ? "desc" : "asc"); resetPage(); }}
      onFolderViewModeChange={(value) => { folders.setFolderViewMode(value); resetPage(); }}
      onIncludePreviewChange={(value) => { taskList.setIncludePreview(value); resetPage(); }}
      onResetFilters={() => {
        taskList.setStatusFilter([]);
        taskList.setScopeFilter("active");
        taskList.setTaskTypeFilter([]);
        taskList.setFolderFilter("all");
        taskList.setSortBy("relevance");
        taskList.setSortDir("desc");
        taskList.setIncludePreview(true);
        resetPage();
      }}
    />
  );
}

export function ProjectTaskTree(props: ProjectTaskListSectionProps & { activeTaskId?: string | null }) {
  const { project } = props;
  const { activeWorkspaceId, navigate, taskList, folders, actions, columns } = props.browser;
  if (taskList.isLoading && !taskList.hasLoadedTaskList) return <TaskListSkeleton />;
  if (taskList.hasLoadedTaskList && taskList.tasks.length === 0 && folders.taskFolders.length === 0) {
    return <div className="task-list-empty">
      {taskList.folderFilter === "unfiled" ? "No tasks in this folder." : "No tasks match the current filters."}
    </div>;
  }
  if (taskList.isLoading) {
    return <TaskListSkeleton rows={Math.min(Math.max(taskList.tasks.length, 3), 8)} />;
  }

  const filtered = isTaskListContentFiltered({
    searchTerm: taskList.searchTerm,
    statusFilter: taskList.statusFilter,
    taskTypeFilter: taskList.taskTypeFilter,
    scopeFilter: taskList.scopeFilter,
    folderFilter: taskList.folderFilter
  });
  const sortBy: TaskSortBy = taskList.searchTerm.trim()
    ? taskList.sortBy
    : taskList.sortBy === "relevance" ? "updated_at" : taskList.sortBy;
  return (
    <TaskTreeList
      folders={folders.taskFolders}
      tasks={taskList.tasks}
      filtered={filtered}
      folderFilter={taskList.folderFilter}
      sortBy={sortBy}
      sortDir={taskList.sortDir}
      folderViewMode={folders.folderViewMode}
      collapsedFolderIds={folders.collapsedFolderIds}
      selectedTaskIdSet={new Set(actions.selectedTaskIds)}
      activeTaskId={props.activeTaskId ?? null}
      openMenuId={actions.openMenuId}
      isAnyTaskActionRunning={actions.activeTaskActionId !== null}
      activeTaskActionId={actions.activeTaskActionId}
      forkingTaskId={actions.forkingTaskId}
      gridColumns={buildTaskListGridTemplate(columns.taskColumnWidths)}
      onToggleFolderCollapsed={actions.toggleFolderCollapsed}
      onOpenMenuChange={actions.setOpenMenuId}
      onToggleTaskSelection={actions.toggleTaskSelection}
      onPrefetchTask={taskList.prefetchTaskRoute}
      onOpenTask={(task) => navigate(`/app/${activeWorkspaceId}/projects/${project.id}/tasks/${task.id}`)}
      onOpenTaskFiles={(task) => navigate(`/app/${activeWorkspaceId}/projects/${project.id}/files?path=${encodeURIComponent(
        task.task_root_path ?? `.meowbert/task-runs/${task.id}`
      )}`)}
      onShareTask={(task) => void actions.handleShareTask(task)}
      onUnshareTask={(task) => void actions.handleUnshareTask(task)}
      onRenameTask={(task) => void actions.handleRename(task)}
      onForkTask={actions.setForkDialogTask}
      onCancelTask={(task) => void actions.handleCancelTask(task)}
      onToggleTrashTask={(task) => void actions.handleToggleTrash(task)}
      onPermanentDeleteTask={(task) => void actions.handlePermanentDelete(task)}
      onMoveTask={(task) => actions.setMoveTarget({ kind: "task", task })}
      onCreateSubfolder={(folder) => void actions.handleCreateFolder(folder)}
      onRenameFolder={(folder) => void actions.handleRenameFolder(folder)}
      onMoveFolder={(folder) => actions.setMoveTarget({ kind: "folder", folder })}
      onDeleteFolder={(folder) => void actions.handleDeleteFolder(folder)}
      onDropTasksToFolder={(taskIds, folderId) => void actions.handleDropTasksToFolder(taskIds, folderId)}
    />
  );
}

export function ProjectTaskPagination({ browser }: Pick<ProjectTaskListSectionProps, "browser">) {
  const { taskList } = browser;
  return (
    <div className="task-pagination task-pagination-spread">
      <button className="btn ghost" disabled={taskList.page <= 1 || taskList.isLoading} onClick={() => taskList.setPage((value) => value - 1)}>
        Previous
      </button>
      <span className="muted-text task-pagination-label">
        Page {taskList.tasks.length > 0 || taskList.page > 1 || taskList.pagination.hasNextPage ? taskList.page : 0}
      </span>
      <button className="btn ghost" disabled={!taskList.pagination.hasNextPage || taskList.isLoading} onClick={() => taskList.setPage((value) => value + 1)}>
        Next
      </button>
    </div>
  );
}

export function ProjectTaskDialogs({ browser }: Pick<ProjectTaskListSectionProps, "browser">) {
  const { folders, actions } = browser;
  return (
    <>
      {actions.moveTarget ? (
        <TaskFolderMoveDialog
          title={actions.moveTarget.kind === "folder" ? "Move folder" : "Move to folder"}
          folders={folders.taskFolders}
          currentFolderId={actions.moveTarget.kind === "task"
            ? actions.moveTarget.task.folder_id ?? null
            : actions.moveTarget.kind === "folder" ? actions.moveTarget.folder.parentFolderId : null}
          disallowedFolderId={actions.moveTarget.kind === "folder" ? actions.moveTarget.folder.id : null}
          onCancel={() => actions.setMoveTarget(null)}
          onConfirm={(folderId) => void actions.handleMoveTargetConfirm(folderId)}
        />
      ) : null}
      {actions.forkDialogTask ? (
        <TaskForkDialog
          title="Fork task"
          initialTitle={`${actions.forkDialogTask.title?.trim() || "Untitled Task"} (Fork)`}
          showTitleField
          isSubmitting={actions.forkingTaskId === actions.forkDialogTask.id}
          onCancel={() => actions.setForkDialogTask(null)}
          onConfirm={(options) => {
            void actions.handleFork(actions.forkDialogTask!, options);
            actions.setForkDialogTask(null);
          }}
        />
      ) : null}
    </>
  );
}

// Closes any open row/bulk menu when the user clicks outside it. Portalled row menus mark themselves with data-task-actions-menu.
export function useDismissTaskMenusOnOutsideClick(
  browser: ProjectTaskBrowser,
  menuRef?: RefObject<HTMLDivElement | null>
): void {
  const { setOpenMenuId } = browser.actions;
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-task-actions-menu]")) return;
      if (!menuRef?.current?.contains(event.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
}
