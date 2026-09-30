function normalizeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export interface TaskRouteContextInput {
  routeWorkspaceId: string | null | undefined;
  routeProjectId?: string | null | undefined;
  routeEnvironmentId?: string | null | undefined;
  taskWorkspaceId: string | null | undefined;
  taskProjectId?: string | null | undefined;
  taskEnvironmentId?: string | null | undefined;
}

export interface TaskRouteContext {
  workspaceId: string | null;
  projectId: string | null;
  environmentId: string | null;
  needsRouteCorrection: boolean;
}

export function resolveTaskRouteContext(input: TaskRouteContextInput): TaskRouteContext {
  const routeWorkspaceId = normalizeId(input.routeWorkspaceId);
  const routeEnvironmentId = normalizeId(input.routeProjectId ?? input.routeEnvironmentId);
  const taskWorkspaceId = normalizeId(input.taskWorkspaceId);
  const taskEnvironmentId = normalizeId(input.taskProjectId ?? input.taskEnvironmentId);
  const workspaceId = taskWorkspaceId ?? routeWorkspaceId;
  const environmentId = taskEnvironmentId ?? routeEnvironmentId;

  return {
    workspaceId,
    projectId: environmentId,
    environmentId,
    needsRouteCorrection:
      taskWorkspaceId !== null
      && taskEnvironmentId !== null
      && (taskWorkspaceId !== routeWorkspaceId || taskEnvironmentId !== routeEnvironmentId)
  };
}

export function buildTaskRoutePath(input: {
  workspaceId: string;
  projectId?: string;
  environmentId?: string;
  taskId: string;
}): string {
  const projectId = input.projectId ?? input.environmentId;
  if (!projectId) {
    throw new Error("buildTaskRoutePath requires a projectId or environmentId");
  }
  return `/app/${input.workspaceId}/projects/${projectId}/tasks/${input.taskId}`;
}
