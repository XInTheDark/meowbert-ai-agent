import { useEffect, useRef, type Ref } from "react";
import type { NavigateFunction } from "react-router-dom";
import { RotateCw, Terminal } from "lucide-react";
import type { Project } from "../../../lib/types";
import { badgeClass } from "../../../lib/utils";
import { TaskListSkeleton } from "../../../components/tasks/TaskListSkeleton";
import { TaskForkDialog } from "../../../components/tasks/TaskForkDialog";
import { DropdownDivider, DropdownItem } from "./ProjectOverviewDropdown";
import { TaskFolderMoveDialog } from "./TaskFolderMoveDialog";
import { TaskListToolbar } from "./TaskListToolbar";
import { TaskTreeList } from "./TaskTreeList";
import { isTaskListContentFiltered } from "./taskFolderTree";
import { buildTaskListGridTemplate } from "./projectOverviewUtils";
import type { TaskSortBy } from "./projectOverviewTypes";
import type { useProjectTaskActions } from "./useProjectTaskActions";
import type { useProjectTaskFolders } from "./useProjectTaskFolders";
import type { useProjectTaskList } from "./useProjectTaskList";
import type { useTaskColumnWidths } from "./useTaskColumnWidths";

const BULK_ACTION_MENU_ID = "__bulk_actions__";

interface ProjectOverviewContentProps {
  project: Project;
  activeWorkspaceId: string;
  navigate: NavigateFunction;
  taskList: ReturnType<typeof useProjectTaskList>;
  folders: ReturnType<typeof useProjectTaskFolders>;
  actions: ReturnType<typeof useProjectTaskActions>;
  columns: ReturnType<typeof useTaskColumnWidths>;
  activePersistentShellCount: number;
}

function ProjectCommandHeader(props: ProjectOverviewContentProps) {
  const { project, activeWorkspaceId, navigate, taskList, actions, activePersistentShellCount } = props;
  const hasAnyMatchingTasks = taskList.tasks.length > 0 || taskList.page > 1 || taskList.pagination.hasNextPage;
  const isAnyTaskActionRunning = actions.activeTaskActionId !== null;
  return (
    <div className="project-command-header">
      <div className="project-command-title">
        <h2>Tasks</h2>
        <div className="project-card-meta">
          <span className={badgeClass(project.status)}>{project.status}</span>
          <span className="project-command-path" title={project.root_path ?? "path pending"}>
            {project.root_path ?? "path pending"}
          </span>
        </div>
      </div>
      <div className="workbench-actions">
        {activePersistentShellCount > 0 ? (
          <button
            className="btn ghost persistent-shells-button"
            onClick={() => navigate(`/app/${activeWorkspaceId}/projects/${project.id}/shells`)}
            title="View active background shells"
          >
            <Terminal size={15} />
            <span>{activePersistentShellCount} active shell{activePersistentShellCount === 1 ? "" : "s"}</span>
          </button>
        ) : null}
        <button className="btn primary" onClick={() => navigate(`/app/${activeWorkspaceId}/projects/${project.id}/tasks/new`)}>
          New Task
        </button>
        <button
          className="btn ghost icon-btn"
          onClick={() => taskList.setRefreshNonce((value) => value + 1)}
          disabled={taskList.isLoading || isAnyTaskActionRunning}
          title="Refresh"
          aria-label="Refresh tasks"
        >
          <RotateCw size={16} />
        </button>
        {taskList.scopeFilter === "trashed" ? (
          <button
            className="btn ghost danger-outline"
            onClick={() => void actions.handleEmptyTrash()}
            disabled={!hasAnyMatchingTasks || isAnyTaskActionRunning}
          >
            Empty Trash
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProjectTaskToolbar(props: ProjectOverviewContentProps) {
  const { taskList, folders } = props;
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

function BulkActionsMenu(props: ProjectOverviewContentProps) {
  const { taskList, actions } = props;
  const hasSelectedTasks = actions.selectedTaskIds.length > 0;
  const hasAnyMatchingTasks = taskList.tasks.length > 0 || taskList.page > 1 || taskList.pagination.hasNextPage;
  const busy = actions.activeTaskActionId !== null;
  return (
    <div className="task-actions-dropdown">
      <DropdownItem onClick={() => { actions.setOpenMenuId(null); void actions.handleCreateFolder(null); }} disabled={busy}>
        New folder
      </DropdownItem>
      <DropdownItem
        onClick={() => {
          actions.setOpenMenuId(null);
          actions.setMoveTarget({ kind: "tasks", taskIds: [...actions.selectedTaskIds] });
        }}
        disabled={!hasSelectedTasks || busy}
      >
        Move selected
      </DropdownItem>
      <DropdownDivider />
      <DropdownItem onClick={() => void actions.handleCancelSelectedTasks()} disabled={!hasSelectedTasks || busy} danger>
        Cancel selected
      </DropdownItem>
      <DropdownItem onClick={() => void actions.handleSetSelectedTasksTrashed(true)} disabled={!hasSelectedTasks || busy}>
        Trash selected
      </DropdownItem>
      <DropdownItem onClick={() => void actions.handleSetSelectedTasksTrashed(false)} disabled={!hasSelectedTasks || busy}>
        Restore selected
      </DropdownItem>
      <DropdownItem
        onClick={() => void actions.handleDeleteSelectedTasksPermanently()}
        disabled={!hasSelectedTasks || taskList.scopeFilter !== "trashed" || busy}
        danger
      >
        Delete selected permanently
      </DropdownItem>
      <DropdownItem
        onClick={() => { actions.setOpenMenuId(null); actions.setSelectedTaskIds([]); }}
        disabled={!hasSelectedTasks || busy}
      >
        Clear selection
      </DropdownItem>
      <DropdownDivider />
      <DropdownItem onClick={() => void actions.handleCancelAllTasks()} disabled={!hasAnyMatchingTasks || busy} danger>
        Cancel all active tasks
      </DropdownItem>
      {taskList.scopeFilter === "trashed" ? (
        <>
          <DropdownDivider />
          <DropdownItem onClick={() => void actions.handleEmptyTrash()} disabled={!hasAnyMatchingTasks || busy} danger>
            Empty trash
          </DropdownItem>
        </>
      ) : null}
    </div>
  );
}

function ProjectTaskBulkBar(props: ProjectOverviewContentProps & {
  menuRef: Ref<HTMLDivElement>;
  selectAllCheckboxRef: Ref<HTMLInputElement>;
  allVisibleTasksSelected: boolean;
}) {
  const { taskList, actions, menuRef, selectAllCheckboxRef, allVisibleTasksSelected } = props;
  const menuOpen = actions.openMenuId === BULK_ACTION_MENU_ID;
  const busy = actions.activeTaskActionId !== null;
  return (
    <div className="task-bulk-bar">
      <label className="task-bulk-select">
        <input
          ref={selectAllCheckboxRef}
          type="checkbox"
          checked={allVisibleTasksSelected}
          onChange={(event) => actions.toggleSelectAllVisible(event.target.checked)}
          disabled={taskList.tasks.length === 0 || busy}
        />
        <span>Select page</span>
      </label>
      <span className="muted-text" style={{ fontSize: "0.85rem" }}>{actions.selectedTaskIds.length} selected</span>
      <div className="task-bulk-actions">
        <div className="task-actions-menu-trigger" ref={menuOpen ? menuRef : null}>
          <button
            type="button"
            className="btn ghost task-bulk-actions-trigger"
            onClick={() => actions.setOpenMenuId(menuOpen ? null : BULK_ACTION_MENU_ID)}
            disabled={busy}
            title="Task actions"
          >
            Actions
          </button>
          {menuOpen ? <BulkActionsMenu {...props} /> : null}
        </div>
      </div>
    </div>
  );
}

function ProjectTaskTree(props: ProjectOverviewContentProps) {
  const { project, activeWorkspaceId, navigate, taskList, folders, actions, columns } = props;
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

function ProjectTaskPagination({ taskList }: Pick<ProjectOverviewContentProps, "taskList">) {
  return (
    <div className="task-pagination task-pagination-spread">
      <button className="btn ghost" disabled={taskList.page <= 1 || taskList.isLoading} onClick={() => taskList.setPage((value) => value - 1)}>
        Previous
      </button>
      <span className="muted-text" style={{ fontSize: "0.9rem" }}>
        Page {taskList.tasks.length > 0 || taskList.page > 1 || taskList.pagination.hasNextPage ? taskList.page : 0}
      </span>
      <button className="btn ghost" disabled={!taskList.pagination.hasNextPage || taskList.isLoading} onClick={() => taskList.setPage((value) => value + 1)}>
        Next
      </button>
    </div>
  );
}

function ProjectTaskDialogs(props: ProjectOverviewContentProps) {
  const { folders, actions } = props;
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

export function ProjectOverviewContent(props: ProjectOverviewContentProps) {
  const { taskList, actions } = props;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const selectedIds = new Set(actions.selectedTaskIds);
  const allVisibleTasksSelected = taskList.tasks.length > 0 && taskList.tasks.every((task) => selectedIds.has(task.id));
  const someVisibleTasksSelected = !allVisibleTasksSelected && taskList.tasks.some((task) => selectedIds.has(task.id));

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-task-actions-menu]")) return;
      if (!menuRef.current?.contains(event.target as Node)) actions.setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (selectAllCheckboxRef.current) selectAllCheckboxRef.current.indeterminate = someVisibleTasksSelected;
  }, [someVisibleTasksSelected, allVisibleTasksSelected]);

  return (
    <section className="workbench-page">
      <article className="workbench-panel padded task-command-panel" data-onboarding-id="project-overview">
        <ProjectCommandHeader {...props} />
        <ProjectTaskToolbar {...props} />
        <ProjectTaskBulkBar
          {...props}
          menuRef={menuRef}
          selectAllCheckboxRef={selectAllCheckboxRef}
          allVisibleTasksSelected={allVisibleTasksSelected}
        />
        {taskList.loadError ? <div className="error-banner" style={{ marginBottom: "1rem" }}>{taskList.loadError}</div> : null}
        <ProjectTaskTree {...props} />
        <ProjectTaskPagination taskList={taskList} />
      </article>
      <ProjectTaskDialogs {...props} />
    </section>
  );
}
