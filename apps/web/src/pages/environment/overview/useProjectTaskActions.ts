import { useState, type Dispatch, type SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage, TaskFolderSummary, TaskSummary } from "../../../lib/types";
import type { TaskForkOptions } from "../../../components/tasks/TaskForkDialog";
import { buildPublicTaskShareUrl, copyTextToClipboard } from "./projectOverviewUtils";
import type { TaskFolderFilter } from "./projectOverviewTypes";

export type TaskFolderMoveTarget =
  | { kind: "task"; task: TaskSummary }
  | { kind: "tasks"; taskIds: string[] }
  | { kind: "folder"; folder: TaskFolderSummary };

interface UseProjectTaskActionsInput {
  api: ApiClient;
  activeProjectId: string | null | undefined;
  activeWorkspaceId: string | null;
  publicBaseUrl: string;
  navigate: NavigateFunction;
  setFlash: (flash: FlashMessage | null) => void;
  tasks: TaskSummary[];
  folderFilter: TaskFolderFilter;
  setFolderFilter: Dispatch<SetStateAction<TaskFolderFilter>>;
  setCollapsedFolderIds: Dispatch<SetStateAction<Set<string>>>;
  setRefreshNonce: Dispatch<SetStateAction<number>>;
}

function useProjectTaskActionState() {
  const [activeTaskActionId, setActiveTaskActionId] = useState<string | null>(null);
  const [forkingTaskId, setForkingTaskId] = useState<string | null>(null);
  const [forkDialogTask, setForkDialogTask] = useState<TaskSummary | null>(null);
  const [moveTarget, setMoveTarget] = useState<TaskFolderMoveTarget | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  return {
    activeTaskActionId,
    setActiveTaskActionId,
    forkingTaskId,
    setForkingTaskId,
    forkDialogTask,
    setForkDialogTask,
    moveTarget,
    setMoveTarget,
    selectedTaskIds,
    setSelectedTaskIds,
    openMenuId,
    setOpenMenuId
  };
}

function useTaskActionRunners(
  input: UseProjectTaskActionsInput,
  state: ReturnType<typeof useProjectTaskActionState>
) {
  async function runTaskAction(taskId: string, action: () => Promise<void>): Promise<boolean> {
    state.setActiveTaskActionId(taskId);
    try {
      await action();
      input.api.invalidateGet?.({ pathPrefix: `/api/tasks/${taskId}` });
      if (input.activeProjectId) {
        input.api.invalidateGet?.({ pathPrefix: `/api/projects/${input.activeProjectId}/tasks` });
      }
      input.setRefreshNonce((value) => value + 1);
      return true;
    } catch (error) {
      input.setFlash({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      state.setActiveTaskActionId(null);
    }
  }

  async function runBulkTaskAction<T>(action: () => Promise<T>): Promise<T | null> {
    state.setActiveTaskActionId("__bulk__");
    try {
      const result = await action();
      if (input.activeProjectId) {
        input.api.invalidateGet?.({ pathPrefix: `/api/projects/${input.activeProjectId}/tasks` });
      }
      input.setRefreshNonce((value) => value + 1);
      return result;
    } catch (error) {
      input.setFlash({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      state.setActiveTaskActionId(null);
    }
  }

  return { runTaskAction, runBulkTaskAction };
}

function useTaskLifecycleActions(
  input: UseProjectTaskActionsInput,
  state: ReturnType<typeof useProjectTaskActionState>,
  runTaskAction: ReturnType<typeof useTaskActionRunners>["runTaskAction"]
) {
  async function handleRename(task: TaskSummary): Promise<void> {
    const nextTitle = window.prompt("Rename task", task.title ?? "");
    if (nextTitle === null) return;
    const renamed = await runTaskAction(task.id, () => input.api.patch(`/api/tasks/${task.id}`, {
      title: nextTitle.trim() || null
    }));
    if (renamed) input.setFlash({ tone: "success", text: "Task renamed." });
  }

  async function handleToggleTrash(task: TaskSummary): Promise<void> {
    const shouldTrash = !task.trashed_at;
    if (!window.confirm(shouldTrash ? "Move this task to trash?" : "Restore this task from trash?")) return;
    const updated = await runTaskAction(task.id, () => input.api.post(`/api/tasks/${task.id}/trash`, { trashed: shouldTrash }));
    if (updated) {
      input.setFlash({ tone: "success", text: shouldTrash ? "Task moved to trash." : "Task restored from trash." });
    }
  }

  async function handlePermanentDelete(task: TaskSummary): Promise<void> {
    if (!task.trashed_at) {
      input.setFlash({ tone: "error", text: "Move task to trash before deleting permanently." });
      return;
    }
    if (!window.confirm("Permanently delete this task and its task directories? This cannot be undone.")) return;
    const deleted = await runTaskAction(task.id, () => input.api.delete(`/api/tasks/${task.id}`));
    if (deleted) {
      state.setSelectedTaskIds((current) => current.filter((taskId) => taskId !== task.id));
      input.setFlash({ tone: "success", text: "Task permanently deleted." });
    }
  }

  async function handleCancelTask(task: TaskSummary): Promise<void> {
    if (!["running", "starting", "queued"].includes(task.status)) {
      input.setFlash({ tone: "error", text: "Only queued, starting, or running tasks can be cancelled." });
      return;
    }
    if (!window.confirm("Cancel this task?")) return;
    const cancelled = await runTaskAction(task.id, () => input.api.post(`/api/tasks/${task.id}/cancel`, {}));
    if (cancelled) input.setFlash({ tone: "success", text: "Cancellation requested." });
  }

  return { handleRename, handleToggleTrash, handlePermanentDelete, handleCancelTask };
}

function useTaskForkAndShareActions(
  input: UseProjectTaskActionsInput,
  state: ReturnType<typeof useProjectTaskActionState>,
  runTaskAction: ReturnType<typeof useTaskActionRunners>["runTaskAction"]
) {
  async function handleFork(task: TaskSummary, options: TaskForkOptions): Promise<void> {
    state.setActiveTaskActionId(task.id);
    state.setForkingTaskId(task.id);
    try {
      const title = options.title?.trim() ?? "";
      const created = await input.api.post<{ taskId: string }>(`/api/tasks/${task.id}/fork`, {
        ...(title ? { title } : {}),
        copyTaskFiles: options.copyTaskFiles
      });
      input.api.invalidateGet?.({ pathPrefix: `/api/projects/${input.activeProjectId}/tasks` });
      input.setFlash({ tone: "success", text: "Forked task created." });
      input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeProjectId}/tasks/${created.taskId}`);
    } catch (error) {
      input.setFlash({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      state.setForkingTaskId(null);
      state.setActiveTaskActionId(null);
    }
  }

  async function handleShareTask(task: TaskSummary): Promise<void> {
    let shareUrl = "";
    let isNew = false;
    const shared = await runTaskAction(task.id, async () => {
      const response = await input.api.post<{ public_path: string; is_new: boolean }>(`/api/tasks/${task.id}/share`, {});
      shareUrl = buildPublicTaskShareUrl(response.public_path, input.publicBaseUrl);
      isNew = response.is_new;
    });
    if (!shared) return;
    const copied = shareUrl ? await copyTextToClipboard(shareUrl) : false;
    if (!copied && shareUrl) window.prompt("Copy this public task link", shareUrl);
    input.setFlash({
      tone: "success",
      text: isNew
        ? copied ? "Public link created and copied." : "Public link created."
        : copied ? "Public link copied." : "Public link is ready to share."
    });
  }

  async function handleUnshareTask(task: TaskSummary): Promise<void> {
    if (!task.is_publicly_shared) {
      input.setFlash({ tone: "error", text: "This task does not have an active public link." });
      return;
    }
    if (!window.confirm("Disable the public link for this task?")) return;
    const unshared = await runTaskAction(task.id, () => input.api.post(`/api/tasks/${task.id}/unshare`, {}));
    if (unshared) input.setFlash({ tone: "success", text: "Public link disabled." });
  }

  return { handleFork, handleShareTask, handleUnshareTask };
}

function useTaskSelection(state: ReturnType<typeof useProjectTaskActionState>, tasks: TaskSummary[]) {
  function toggleTaskSelection(taskId: string, checked: boolean): void {
    state.setSelectedTaskIds((current) => checked
      ? current.includes(taskId) ? current : [...current, taskId]
      : current.filter((id) => id !== taskId));
  }

  function toggleSelectAllVisible(checked: boolean): void {
    const visibleTaskIds = tasks.map((task) => task.id);
    state.setSelectedTaskIds((current) => checked
      ? Array.from(new Set([...current, ...visibleTaskIds]))
      : current.filter((taskId) => !new Set(visibleTaskIds).has(taskId)));
  }

  return { toggleTaskSelection, toggleSelectAllVisible };
}

function useBulkTaskActions(
  input: UseProjectTaskActionsInput,
  state: ReturnType<typeof useProjectTaskActionState>,
  runBulkTaskAction: ReturnType<typeof useTaskActionRunners>["runBulkTaskAction"]
) {
  async function handleCancelSelectedTasks(): Promise<void> {
    if (!input.activeProjectId || state.selectedTaskIds.length === 0) return;
    const taskIds = [...state.selectedTaskIds];
    if (!window.confirm(`Cancel selected tasks (${taskIds.length})?`)) return;
    state.setOpenMenuId(null);
    const result = await runBulkTaskAction(() => input.api.post<{ cancelledCount: number }>(
      `/api/projects/${input.activeProjectId}/tasks/cancel`, { taskIds }
    ));
    if (!result) return;
    state.setSelectedTaskIds([]);
    input.setFlash({
      tone: "success",
      text: result.cancelledCount > 0
        ? `Cancellation requested for ${result.cancelledCount} task(s).`
        : "No queued, starting, or running tasks were selected."
    });
  }

  async function handleSetSelectedTasksTrashed(trashed: boolean): Promise<void> {
    if (state.selectedTaskIds.length === 0) return;
    const taskIds = [...state.selectedTaskIds];
    const label = trashed ? "Move selected tasks to trash" : "Restore selected tasks from trash";
    if (!window.confirm(`${label} (${taskIds.length})?`)) return;
    state.setOpenMenuId(null);
    const results = await runBulkTaskAction(() => Promise.allSettled(
      taskIds.map((taskId) => input.api.post(`/api/tasks/${taskId}/trash`, { trashed }))
    ));
    if (!results) return;
    const successCount = results.filter((result) => result.status === "fulfilled").length;
    const failureCount = results.length - successCount;
    state.setSelectedTaskIds([]);
    input.setFlash({
      tone: failureCount > 0 ? "error" : "success",
      text: successCount === 0
        ? trashed ? "No selected tasks were moved to trash." : "No selected tasks were restored."
        : failureCount > 0
          ? `${trashed ? "Moved" : "Restored"} ${successCount} task(s). ${failureCount} failed.`
          : trashed ? `Moved ${successCount} task(s) to trash.` : `Restored ${successCount} task(s).`
    });
  }

  async function handleDeleteSelectedTasksPermanently(): Promise<void> {
    if (state.selectedTaskIds.length === 0) return;
    const taskIds = [...state.selectedTaskIds];
    if (!window.confirm(`Permanently delete selected tasks (${taskIds.length}) and their task directories? This cannot be undone.`)) return;
    state.setOpenMenuId(null);
    const results = await runBulkTaskAction(() => Promise.allSettled(
      taskIds.map((taskId) => input.api.delete(`/api/tasks/${taskId}`))
    ));
    if (!results) return;
    const successCount = results.filter((result) => result.status === "fulfilled").length;
    const failureCount = results.length - successCount;
    state.setSelectedTaskIds([]);
    input.setFlash({
      tone: failureCount > 0 ? "error" : "success",
      text: successCount === 0
        ? "No selected tasks were permanently deleted."
        : failureCount > 0 ? `Deleted ${successCount} task(s). ${failureCount} failed.` : `Permanently deleted ${successCount} task(s).`
    });
  }

  return { handleCancelSelectedTasks, handleSetSelectedTasksTrashed, handleDeleteSelectedTasksPermanently };
}

function useTaskFolderCrudActions(
  input: UseProjectTaskActionsInput,
  runBulkTaskAction: ReturnType<typeof useTaskActionRunners>["runBulkTaskAction"]
) {
  async function handleCreateFolder(parentFolder: TaskFolderSummary | null): Promise<void> {
    if (!input.activeProjectId) return;
    const name = window.prompt(parentFolder ? `New folder in ${parentFolder.name}` : "New folder");
    const trimmedName = name?.trim() ?? "";
    if (!trimmedName) return;
    const result = await runBulkTaskAction(() => input.api.post(`/api/projects/${input.activeProjectId}/task-folders`, {
      name: trimmedName,
      parentFolderId: parentFolder?.id ?? null
    }));
    if (result) input.setFlash({ tone: "success", text: "Folder created." });
  }

  async function handleRenameFolder(folder: TaskFolderSummary): Promise<void> {
    const name = window.prompt("Rename folder", folder.name);
    const trimmedName = name?.trim() ?? "";
    if (!trimmedName || trimmedName === folder.name) return;
    const result = await runBulkTaskAction(() => input.api.patch(`/api/task-folders/${folder.id}`, { name: trimmedName }));
    if (result) input.setFlash({ tone: "success", text: "Folder renamed." });
  }

  async function handleDeleteFolder(folder: TaskFolderSummary): Promise<void> {
    if (!window.confirm(`Delete folder "${folder.name}"? Tasks and subfolders will move up one level.`)) return;
    const result = await runBulkTaskAction(() => input.api.delete(`/api/task-folders/${folder.id}`));
    if (!result) return;
    input.setCollapsedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folder.id);
      return next;
    });
    if (input.folderFilter === folder.id) input.setFolderFilter("all");
    input.setFlash({ tone: "success", text: "Folder deleted." });
  }

  function toggleFolderCollapsed(folderId: string): void {
    input.setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  return { handleCreateFolder, handleRenameFolder, handleDeleteFolder, toggleFolderCollapsed };
}

function useTaskFolderMoveActions(
  input: UseProjectTaskActionsInput,
  state: ReturnType<typeof useProjectTaskActionState>,
  runBulkTaskAction: ReturnType<typeof useTaskActionRunners>["runBulkTaskAction"]
) {
  async function handleMoveTargetConfirm(folderId: string | null): Promise<void> {
    if (!input.activeProjectId || !state.moveTarget) return;
    const target = state.moveTarget;
    state.setMoveTarget(null);
    if (target.kind === "folder") {
      const result = await runBulkTaskAction(() => input.api.patch(`/api/task-folders/${target.folder.id}`, {
        parentFolderId: folderId
      }));
      if (result) input.setFlash({ tone: "success", text: "Folder moved." });
      return;
    }
    const taskIds = target.kind === "task" ? [target.task.id] : target.taskIds;
    const result = await runBulkTaskAction(() => input.api.post<{ movedCount: number }>(
      `/api/projects/${input.activeProjectId}/tasks/move`, { taskIds, folderId }
    ));
    if (result) {
      state.setSelectedTaskIds((current) => current.filter((taskId) => !taskIds.includes(taskId)));
      input.setFlash({ tone: "success", text: result.movedCount === 1 ? "Task moved." : `Moved ${result.movedCount} task(s).` });
    }
  }

  async function handleDropTasksToFolder(taskIds: string[], folderId: string | null): Promise<void> {
    if (!input.activeProjectId) return;
    const taskIdSet = new Set(taskIds);
    const movableTaskIds = input.tasks
      .filter((task) => taskIdSet.has(task.id) && (task.folder_id ?? null) !== folderId)
      .map((task) => task.id);
    if (movableTaskIds.length === 0) return;
    const result = await runBulkTaskAction(() => input.api.post<{ movedCount: number }>(
      `/api/projects/${input.activeProjectId}/tasks/move`, { taskIds: movableTaskIds, folderId }
    ));
    if (result?.movedCount) {
      state.setSelectedTaskIds((current) => current.filter((taskId) => !movableTaskIds.includes(taskId)));
      input.setFlash({ tone: "success", text: result.movedCount === 1 ? "Task moved." : `Moved ${result.movedCount} task(s).` });
    }
  }

  return { handleMoveTargetConfirm, handleDropTasksToFolder };
}

function useProjectWideTaskActions(
  input: UseProjectTaskActionsInput,
  state: ReturnType<typeof useProjectTaskActionState>,
  runBulkTaskAction: ReturnType<typeof useTaskActionRunners>["runBulkTaskAction"]
) {
  async function handleCancelAllTasks(): Promise<void> {
    if (!input.activeProjectId || !window.confirm("Cancel all queued, starting, and running tasks in this project?")) return;
    state.setOpenMenuId(null);
    const result = await runBulkTaskAction(() => input.api.post<{ cancelledCount: number }>(
      `/api/projects/${input.activeProjectId}/tasks/cancel`, {}
    ));
    if (!result) return;
    state.setSelectedTaskIds([]);
    input.setFlash({
      tone: "success",
      text: result.cancelledCount > 0
        ? `Cancellation requested for ${result.cancelledCount} task(s).`
        : "No queued, starting, or running tasks to cancel."
    });
  }

  async function handleEmptyTrash(): Promise<void> {
    if (!input.activeProjectId || !window.confirm("Permanently delete every trashed task in this project and remove its task directories?")) return;
    state.setOpenMenuId(null);
    const result = await runBulkTaskAction(() => input.api.post<{ deletedTaskCount: number }>(
      `/api/projects/${input.activeProjectId}/tasks/empty-trash`, {}
    ));
    if (!result) return;
    state.setSelectedTaskIds([]);
    input.setFlash({
      tone: "success",
      text: result.deletedTaskCount > 0 ? `Permanently deleted ${result.deletedTaskCount} task(s).` : "Trash is already empty."
    });
  }

  return { handleCancelAllTasks, handleEmptyTrash };
}

export function useProjectTaskActions(input: UseProjectTaskActionsInput) {
  const state = useProjectTaskActionState();
  const runners = useTaskActionRunners(input, state);
  return {
    ...state,
    ...useTaskLifecycleActions(input, state, runners.runTaskAction),
    ...useTaskForkAndShareActions(input, state, runners.runTaskAction),
    ...useTaskSelection(state, input.tasks),
    ...useBulkTaskActions(input, state, runners.runBulkTaskAction),
    ...useTaskFolderCrudActions(input, runners.runBulkTaskAction),
    ...useTaskFolderMoveActions(input, state, runners.runBulkTaskAction),
    ...useProjectWideTaskActions(input, state, runners.runBulkTaskAction)
  };
}
