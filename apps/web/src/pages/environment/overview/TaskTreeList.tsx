import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Loader2 } from "lucide-react";
import type { TaskFolderSummary, TaskSummary } from "../../../lib/types";
import { badgeClass, formatDateTime, formatRelative, formatTaskTypeLabel } from "../../../lib/utils";
import { TaskStatusBadge } from "../../../components/tasks/TaskStatusBadge";
import { TaskSearchPreview } from "../../../components/search/TaskSearchPreview";
import {
  ExplorerBody,
  ExplorerCell,
  ExplorerCheckbox,
  ExplorerHeader,
  ExplorerRow,
  ExplorerTable
} from "../../../components/explorer/ExplorerTable";
import { DropdownDivider, DropdownItem } from "./ProjectOverviewDropdown";
import { TaskActionsMenu } from "./TaskActionsMenu";
import type { TaskFolderFilter, TaskFolderViewMode, TaskSortBy, TaskSortDir } from "./projectOverviewTypes";
import { buildTaskTreeRows } from "./taskFolderTree";

export interface TaskTreeListProps {
  folders: TaskFolderSummary[];
  tasks: TaskSummary[];
  filtered: boolean;
  folderFilter: TaskFolderFilter;
  sortBy: TaskSortBy;
  sortDir: TaskSortDir;
  folderViewMode: TaskFolderViewMode;
  collapsedFolderIds: Set<string>;
  selectedTaskIdSet: Set<string>;
  activeTaskId?: string | null;
  openMenuId: string | null;
  isAnyTaskActionRunning: boolean;
  activeTaskActionId: string | null;
  forkingTaskId: string | null;
  gridColumns: string;
  onToggleFolderCollapsed: (folderId: string) => void;
  onOpenMenuChange: (menuId: string | null) => void;
  onToggleTaskSelection: (taskId: string, checked: boolean) => void;
  onPrefetchTask: (task: TaskSummary) => void;
  onOpenTask: (task: TaskSummary) => void;
  onOpenTaskFiles: (task: TaskSummary) => void;
  onShareTask: (task: TaskSummary) => void;
  onUnshareTask: (task: TaskSummary) => void;
  onRenameTask: (task: TaskSummary) => void;
  onForkTask: (task: TaskSummary) => void;
  onCancelTask: (task: TaskSummary) => void;
  onToggleTrashTask: (task: TaskSummary) => void;
  onPermanentDeleteTask: (task: TaskSummary) => void;
  onMoveTask: (task: TaskSummary) => void;
  onCreateSubfolder: (folder: TaskFolderSummary | null) => void;
  onRenameFolder: (folder: TaskFolderSummary) => void;
  onMoveFolder: (folder: TaskFolderSummary) => void;
  onDeleteFolder: (folder: TaskFolderSummary) => void;
  onDropTasksToFolder: (taskIds: string[], folderId: string | null) => void;
}

const ROOT_DROP_ID = "__task_folder_root_drop__";

function folderMenuId(folderId: string): string {
  return `folder:${folderId}`;
}

export function TaskTreeList(props: TaskTreeListProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const rows = useMemo(() => buildTaskTreeRows({
    folders: props.folders,
    tasks: props.tasks,
    collapsedFolderIds: props.collapsedFolderIds,
    filtered: props.filtered,
    folderFilter: props.folderFilter,
    folderViewMode: props.folderViewMode,
    sortBy: props.sortBy,
    sortDir: props.sortDir
  }), [props.collapsedFolderIds, props.filtered, props.folderFilter, props.folderViewMode, props.folders, props.sortBy, props.sortDir, props.tasks]);

  function handleTaskDragStart(event: React.DragEvent<HTMLDivElement>, taskId: string): void {
    if (props.isAnyTaskActionRunning) {
      event.preventDefault();
      return;
    }
    const taskIds = props.selectedTaskIdSet.has(taskId) ? [...props.selectedTaskIdSet] : [taskId];
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    event.dataTransfer.setData("application/json", JSON.stringify(taskIds));
    setDraggingTaskId(taskId);
  }

  function handleDragEnd(): void {
    setDraggingTaskId(null);
    setDragOverFolderId(null);
  }

  function handleFolderDragOver(event: React.DragEvent<HTMLDivElement>, folderId: string | null): void {
    if (!draggingTaskId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folderId ?? ROOT_DROP_ID);
  }

  function handleFolderDrop(event: React.DragEvent<HTMLDivElement>, folderId: string | null): void {
    event.preventDefault();
    event.stopPropagation();
    const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId;
    const rawTaskIds = event.dataTransfer.getData("application/json");
    handleDragEnd();
    if (!taskId) {
      return;
    }
    let taskIds = [taskId];
    try {
      const parsed = JSON.parse(rawTaskIds);
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
        taskIds = parsed;
      }
    } catch {
      taskIds = [taskId];
    }
    props.onDropTasksToFolder(taskIds, folderId);
  }

  return (
    <ExplorerTable
      className={`task-list-container task-tree-container ${dragOverFolderId === ROOT_DROP_ID ? "is-drag-over-root" : ""}`}
      columns={props.gridColumns}
      onDragOver={(event) => handleFolderDragOver(event, null)}
      onDrop={(event) => handleFolderDrop(event, null)}
    >
      <ExplorerHeader className="task-list-header">
        <ExplorerCell align="center">Sel</ExplorerCell>
        <ExplorerCell>Task</ExplorerCell>
        <ExplorerCell className="task-status-header-cell">Status</ExplorerCell>
        <ExplorerCell>Updated</ExplorerCell>
        <ExplorerCell>Created</ExplorerCell>
        <ExplorerCell align="right">Actions</ExplorerCell>
      </ExplorerHeader>

      <ExplorerBody className="task-list-body">
        {rows.length === 0 ? (
          <div className="task-list-empty">
            {props.folderFilter === "all" ? "No tasks match the current filters." : "No tasks in this folder."}
          </div>
        ) : null}
        {rows.map((row) => {
          if (row.kind === "folder") {
            const isOpen = props.filtered || !props.collapsedFolderIds.has(row.folder.id);
            const isMenuOpen = props.openMenuId === folderMenuId(row.folder.id);
            const isDropTarget = dragOverFolderId === row.folder.id;
            return (
              <ExplorerRow
                key={`folder-${row.folder.id}`}
                className={`task-folder-row ${isDropTarget ? "is-drag-over" : ""} ${isMenuOpen ? "menu-open" : ""}`}
                style={{ "--task-tree-depth": row.depth } as React.CSSProperties}
                title={row.folder.name}
                onDragOver={(event) => handleFolderDragOver(event, row.folder.id)}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={(event) => handleFolderDrop(event, row.folder.id)}
              >
                <ExplorerCell className="task-folder-toggle-cell" align="center">
                  <button
                    type="button"
                    className="btn ghost icon-btn task-folder-toggle"
                    onClick={() => props.onToggleFolderCollapsed(row.folder.id)}
                    aria-label={isOpen ? `Collapse ${row.folder.name}` : `Expand ${row.folder.name}`}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                </ExplorerCell>
                <ExplorerCell className="task-folder-main">
                  {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
                  <span className="task-folder-name">{row.folder.name}</span>
                  <span className="task-folder-count muted-text">
                    {row.taskCount} tasks · {row.childFolderCount} folders
                  </span>
                </ExplorerCell>
                <ExplorerCell className="task-actions-cell task-folder-actions-cell" align="right">
                  <TaskActionsMenu
                    open={isMenuOpen}
                    onToggle={() => props.onOpenMenuChange(isMenuOpen ? null : folderMenuId(row.folder.id))}
                    title="Folder actions"
                  >
                    {isMenuOpen ? (
                      <>
                        <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onCreateSubfolder(row.folder); }}>
                          New subfolder
                        </DropdownItem>
                        <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onRenameFolder(row.folder); }}>
                          Rename
                        </DropdownItem>
                        <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onMoveFolder(row.folder); }}>
                          Move folder
                        </DropdownItem>
                        <DropdownDivider />
                        <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onDeleteFolder(row.folder); }} danger>
                          Delete folder
                        </DropdownItem>
                      </>
                    ) : null}
                  </TaskActionsMenu>
                </ExplorerCell>
              </ExplorerRow>
            );
          }

          const task = row.task;
          const isBusy = props.activeTaskActionId === task.id;
          const updatedAtTitle = formatDateTime(task.updated_at);
          const createdAtTitle = formatDateTime(task.created_at);
          const taskTitle = task.title || "Untitled Task";
          const taskTooltip = `${taskTitle}\n${task.id}`;
          return (
            <ExplorerRow
              key={task.id}
              className={`task-item task-tree-task-item ${task.trashed_at ? "trashed" : ""} ${props.openMenuId === task.id ? "menu-open" : ""} ${props.activeTaskId === task.id ? "is-active" : ""}`}
              style={{ "--task-tree-depth": row.depth } as React.CSSProperties}
              title={taskTooltip}
              draggable={!props.isAnyTaskActionRunning}
              onDragStart={(event) => handleTaskDragStart(event, task.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(event) => handleFolderDragOver(event, task.folder_id ?? null)}
              onDragLeave={() => setDragOverFolderId(null)}
              onDrop={(event) => handleFolderDrop(event, task.folder_id ?? null)}
            >
              <ExplorerCell className="task-select-cell" align="center">
                <ExplorerCheckbox
                  checked={props.selectedTaskIdSet.has(task.id)}
                  onChange={(checked) => props.onToggleTaskSelection(task.id, checked)}
                  disabled={props.isAnyTaskActionRunning}
                  ariaLabel={`Select task ${task.title ?? task.id}`}
                />
              </ExplorerCell>

              <ExplorerCell className="task-main-col">
                <div className="task-title-row">
                  <button
                    type="button"
                    onPointerEnter={() => props.onPrefetchTask(task)}
                    onFocus={() => props.onPrefetchTask(task)}
                    onClick={() => props.onOpenTask(task)}
                    className="task-title"
                  >
                    {taskTitle}
                  </button>
                  {task.task_type && task.task_type !== "standard" ? (
                    <span className="badge muted task-type-pill">{formatTaskTypeLabel(task.task_type)}</span>
                  ) : null}
                  {task.is_publicly_shared ? (
                    <span className="badge muted task-type-pill">public</span>
                  ) : null}
                  {task.schedule_state ? (
                    <span className={`${badgeClass(task.schedule_state)} task-type-pill`}>{task.schedule_state}</span>
                  ) : null}
                </div>
                <TaskSearchPreview preview={task.searchPreview} />
                {props.forkingTaskId === task.id ? (
                  <span className="task-forking-status" role="status" aria-live="polite">
                    <Loader2 className="spin" size={13} />
                    Forking task...
                  </span>
                ) : null}
                {task.schedule_next_run_at ? (
                  <span className="task-next-run muted-text">
                    Next run {formatRelative(task.schedule_next_run_at)}
                  </span>
                ) : null}
              </ExplorerCell>

              <ExplorerCell className="task-status-cell-wrapper">
                <TaskStatusBadge status={task.status} className="task-status-cell" />
              </ExplorerCell>
              <time className="task-updated-cell muted-text" dateTime={task.updated_at} title={updatedAtTitle}>
                {formatRelative(task.updated_at)}
              </time>
              <time className="task-created-cell muted-text" dateTime={task.created_at} title={createdAtTitle}>
                {formatRelative(task.created_at)}
              </time>

              <ExplorerCell className="task-actions-cell" align="right">
                <TaskActionsMenu
                  open={props.openMenuId === task.id}
                  onToggle={() => props.onOpenMenuChange(props.openMenuId === task.id ? null : task.id)}
                  disabled={props.isAnyTaskActionRunning}
                  title="Actions"
                >
                  {props.openMenuId === task.id ? (
                    <>
                      <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onOpenTask(task); }}>
                        Open
                      </DropdownItem>
                      <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onOpenTaskFiles(task); }}>
                        View Files
                      </DropdownItem>
                      <DropdownDivider />
                      <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onShareTask(task); }} disabled={isBusy}>
                        Copy Public Link
                      </DropdownItem>
                      {task.is_publicly_shared ? (
                        <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onUnshareTask(task); }} disabled={isBusy} danger>
                          Disable Public Link
                        </DropdownItem>
                      ) : null}
                      <DropdownDivider />
                      <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onRenameTask(task); }}>
                        Rename
                      </DropdownItem>
                      <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onMoveTask(task); }} disabled={isBusy}>
                        Move to folder
                      </DropdownItem>
                      <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onForkTask(task); }} disabled={isBusy}>
                        Fork
                      </DropdownItem>
                      <DropdownItem
                        onClick={() => { props.onOpenMenuChange(null); props.onCancelTask(task); }}
                        disabled={isBusy || (task.status !== "running" && task.status !== "starting" && task.status !== "queued")}
                        danger
                      >
                        Cancel
                      </DropdownItem>
                      <DropdownDivider />
                      <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onToggleTrashTask(task); }} disabled={isBusy} danger={!task.trashed_at}>
                        {task.trashed_at ? "Restore" : "Trash"}
                      </DropdownItem>
                      {task.trashed_at ? (
                        <DropdownItem onClick={() => { props.onOpenMenuChange(null); props.onPermanentDeleteTask(task); }} disabled={isBusy} danger>
                          Delete Permanently
                        </DropdownItem>
                      ) : null}
                    </>
                  ) : null}
                </TaskActionsMenu>
              </ExplorerCell>
            </ExplorerRow>
          );
        })}
      </ExplorerBody>
    </ExplorerTable>
  );
}
