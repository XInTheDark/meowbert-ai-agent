import { useEffect, useRef, type Ref } from "react";
import { RotateCw, Terminal } from "lucide-react";
import { badgeClass } from "../../../lib/utils";
import { DropdownDivider, DropdownItem } from "./ProjectOverviewDropdown";
import {
  ProjectTaskDialogs,
  ProjectTaskPagination,
  ProjectTaskToolbar,
  ProjectTaskTree,
  useDismissTaskMenusOnOutsideClick,
  type ProjectTaskListSectionProps
} from "./ProjectTaskListSections";

const BULK_ACTION_MENU_ID = "__bulk_actions__";

interface ProjectOverviewContentProps extends ProjectTaskListSectionProps {
  activePersistentShellCount: number;
}

function ProjectCommandHeader(props: ProjectOverviewContentProps) {
  const { project, activePersistentShellCount } = props;
  const { activeWorkspaceId, navigate, taskList, actions } = props.browser;
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

function BulkActionsMenu(props: ProjectOverviewContentProps) {
  const { taskList, actions } = props.browser;
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
  const { menuRef, selectAllCheckboxRef, allVisibleTasksSelected } = props;
  const { taskList, actions } = props.browser;
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

export function ProjectOverviewContent(props: ProjectOverviewContentProps) {
  const { taskList, actions } = props.browser;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const selectedIds = new Set(actions.selectedTaskIds);
  const allVisibleTasksSelected = taskList.tasks.length > 0 && taskList.tasks.every((task) => selectedIds.has(task.id));
  const someVisibleTasksSelected = !allVisibleTasksSelected && taskList.tasks.some((task) => selectedIds.has(task.id));

  useDismissTaskMenusOnOutsideClick(props.browser, menuRef);

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
        <ProjectTaskPagination browser={props.browser} />
      </article>
      <ProjectTaskDialogs browser={props.browser} />
    </section>
  );
}
