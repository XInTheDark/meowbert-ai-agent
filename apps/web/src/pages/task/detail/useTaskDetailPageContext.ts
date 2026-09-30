import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAppRuntime } from "../../../contexts/AppRuntimeContext";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import { useTaskInputCatalog } from "../../../hooks/useTaskInputCatalog";
import { useDocumentTitle } from "../../../lib/documentTitle";
import { buildTaskRoutePath, resolveTaskRouteContext } from "../../../task/taskRouteContext";
import {
  getTaskAssistantMessageDisplayPreferencesForUser,
  getTaskUiPreferencesForUser
} from "../../../task/taskPagePreferences";
import { useSubscriptionUsageWarning } from "../../../subscription/usageLimits";
import { useTaskDetailData } from "./useTaskDetailData";

function useResolvedTaskRoute(
  taskDetail: ReturnType<typeof useTaskDetailData>["taskDetail"],
  activeWorkspaceId: string | null,
  activeProjectId: string | null
) {
  const params = useParams<{ workspaceId: string; projectId: string; taskId: string }>();
  const taskId = params.taskId ?? "";
  const route = useMemo(() => resolveTaskRouteContext({
    routeWorkspaceId: params.workspaceId ?? activeWorkspaceId,
    routeProjectId: params.projectId ?? activeProjectId,
    taskWorkspaceId: taskDetail?.task.workspace_id ?? null,
    taskProjectId: taskDetail?.task.project_id ?? null,
    taskEnvironmentId: taskDetail?.task.environment_id ?? null
  }), [
    activeProjectId,
    activeWorkspaceId,
    params.projectId,
    params.workspaceId,
    taskDetail?.task.environment_id,
    taskDetail?.task.project_id,
    taskDetail?.task.workspace_id
  ]);
  return { taskId, route };
}

export function useTaskDetailPageContext() {
  const workspace = useWorkspaceApp();
  const runtime = useAppRuntime();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId ?? "";
  const activeProjectId = workspace.activeProjectId ?? workspace.activeEnvironmentId;
  const projects = workspace.projects ?? workspace.environments;
  const [error, setError] = useState<string | null>(null);
  const handleTaskReset = useCallback(() => setError(null), []);
  const data = useTaskDetailData({
    api: workspace.api,
    token: workspace.token,
    taskId,
    onTaskReset: handleTaskReset
  });
  const resolvedRoute = useResolvedTaskRoute(data.taskDetail, workspace.activeWorkspaceId, activeProjectId);
  const taskWorkspaceId = resolvedRoute.route.workspaceId;
  const taskProjectId = resolvedRoute.route.projectId;
  const catalog = useTaskInputCatalog(workspace.api, taskWorkspaceId, workspace.user?.is_super_admin === true);
  const taskRootPath = data.taskDetail?.task.task_root_path ?? null;
  const activeProject = useMemo(
    () => projects.find((project) => project.id === taskProjectId),
    [projects, taskProjectId]
  );
  const taskTitle = useMemo(() => {
    const title = data.taskDetail?.task.title?.trim();
    return title || data.taskDetail?.task.id || "Task";
  }, [data.taskDetail]);
  const workspaceMemoryEnabled = workspace.workspaceSettings?.memoryEnabled === true;
  const messageDisplayPreferences = useMemo(
    () => getTaskAssistantMessageDisplayPreferencesForUser(workspace.user),
    [workspace.user?.task_page_preferences]
  );
  const taskUiPreferences = useMemo(
    () => getTaskUiPreferencesForUser(workspace.user),
    [workspace.user?.task_page_preferences]
  );
  const subscriptionUsageWarning = useSubscriptionUsageWarning();

  useDocumentTitle(taskTitle, activeProject?.name ?? null);
  useEffect(() => {
    if (!taskId || !resolvedRoute.route.needsRouteCorrection || !taskWorkspaceId || !taskProjectId) return;
    navigate(buildTaskRoutePath({ workspaceId: taskWorkspaceId, projectId: taskProjectId, taskId }), { replace: true });
  }, [navigate, resolvedRoute.route.needsRouteCorrection, taskId, taskProjectId, taskWorkspaceId]);

  return {
    workspace,
    runtime,
    navigate,
    location,
    taskId,
    taskWorkspaceId,
    taskProjectId,
    taskRootPath,
    activeProjectId,
    activeProject,
    catalog,
    data,
    error,
    setError,
    workspaceMemoryEnabled,
    messageDisplayPreferences,
    taskUiPreferences,
    subscriptionUsageWarning
  };
}

export type TaskDetailPageContext = ReturnType<typeof useTaskDetailPageContext>;
