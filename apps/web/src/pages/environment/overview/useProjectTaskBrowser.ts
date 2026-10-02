import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppRuntime } from "../../../contexts/AppRuntimeContext";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import { useProjectTaskActions } from "./useProjectTaskActions";
import { useProjectTaskFolders } from "./useProjectTaskFolders";
import { useProjectTaskList } from "./useProjectTaskList";
import { useTaskColumnWidths } from "./useTaskColumnWidths";

// Everything a project task list needs (query, folders, row actions, column widths), shared by the full list and the Master side pane.
export function useProjectTaskBrowser(initialSearch = "") {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId, setFlash } = workspaceApp;
  const activeProjectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const { publicServerConfig } = useAppRuntime();
  const navigate = useNavigate();
  const publicBaseUrl = publicServerConfig?.appUrl ?? window.location.origin;

  const taskList = useProjectTaskList(api, activeProjectId, initialSearch);
  const folders = useProjectTaskFolders(api, activeProjectId, taskList.refreshNonce);
  const columns = useTaskColumnWidths();
  const actions = useProjectTaskActions({
    api,
    activeProjectId,
    activeWorkspaceId,
    publicBaseUrl,
    navigate,
    setFlash,
    tasks: taskList.tasks,
    folderFilter: taskList.folderFilter,
    setFolderFilter: taskList.setFolderFilter,
    setCollapsedFolderIds: folders.setCollapsedFolderIds,
    setRefreshNonce: taskList.setRefreshNonce
  });

  useEffect(() => {
    actions.setSelectedTaskIds([]);
    actions.setMoveTarget(null);
    actions.setOpenMenuId(null);
  }, [activeProjectId]);

  useEffect(() => {
    const visibleTaskIds = new Set(taskList.tasks.map((task) => task.id));
    actions.setSelectedTaskIds((current) => current.filter((taskId) => visibleTaskIds.has(taskId)));
  }, [taskList.tasks]);

  return { activeProjectId, activeWorkspaceId, navigate, taskList, folders, actions, columns };
}

export type ProjectTaskBrowser = ReturnType<typeof useProjectTaskBrowser>;
