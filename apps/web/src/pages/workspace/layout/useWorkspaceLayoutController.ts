import { useCallback, useEffect, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { ApiError, createApiClient, type ApiClient } from "../../../lib/api";
import { API_CACHE_TTLS } from "../../../lib/api-cache";
import type {
  Environment,
  FlashMessage,
  TaskSummary,
  UserProfile,
  Workspace,
  WorkspaceSettings
} from "../../../lib/types";
import { saveLastWorkspaceId } from "./utils";

interface UseWorkspaceLayoutControllerInput {
  token: string;
  activeWorkspaceId: string;
  activeEnvironmentId: string | null;
  navigate: NavigateFunction;
  pathname: string;
  onLogout: () => void;
  onReplaceSessionToken: (token: string) => void;
  setFlash: (flash: FlashMessage | null) => void;
}

interface WorkspaceLayoutControllerResult {
  api: ApiClient;
  user: UserProfile | null;
  workspaces: Workspace[];
  environments: Environment[];
  tasks: TaskSummary[];
  workspaceSettings: WorkspaceSettings | null;
  isWorkspaceSettingsLoading: boolean;
  isBootstrapping: boolean;
  isEnvironmentsLoading: boolean;
  isTasksLoading: boolean;
  navError: string | null;
  activeWorkspace: Workspace | undefined;
  activeEnvironment: Environment | undefined;
  refreshWorkspaces: () => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshWorkspaceSettings: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  createEnvironment: (name: string) => Promise<void>;
  patchEnvironment: (
    environmentId: string,
    input: { name?: string; status?: "active" | "archived" | "error"; jsonPayload?: Record<string, unknown> }
  ) => Promise<void>;
  replaceSessionToken: (token: string) => void;
}

interface WorkspaceBootstrapResponse {
  user: UserProfile;
  workspaces: Workspace[];
  projects: Environment[];
  workspaceSettings: WorkspaceSettings;
  activeProject: Environment | null;
}

export function getEnvironmentSortTimestamp(environment: Environment): string {
  return environment.updated_at ?? environment.created_at ?? "";
}

export function sortEnvironments(environments: Environment[]): Environment[] {
  return [...environments].sort((left, right) => getEnvironmentSortTimestamp(right).localeCompare(getEnvironmentSortTimestamp(left)));
}

export function upsertEnvironment(environments: Environment[], environment: Environment): Environment[] {
  const remaining = environments.filter((item) => item.id !== environment.id);
  return sortEnvironments([environment, ...remaining]);
}

export function shouldLogoutForWorkspaceBootstrapError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function useWorkspaceLayoutController(
  input: UseWorkspaceLayoutControllerInput
): WorkspaceLayoutControllerResult {
  const api = useMemo(() => createApiClient(input.token), [input.token]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [isWorkspaceSettingsLoading, setIsWorkspaceSettingsLoading] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isEnvironmentsLoading, setIsEnvironmentsLoading] = useState(false);
  const [hasLoadedEnvironments, setHasLoadedEnvironments] = useState(false);
  const [isTasksLoading, setIsTasksLoading] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === input.activeWorkspaceId),
    [input.activeWorkspaceId, workspaces]
  );
  const activeEnvironment = useMemo(
    () => environments.find((environment) => environment.id === input.activeEnvironmentId),
    [environments, input.activeEnvironmentId]
  );

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const me = await api.get<{ user: UserProfile; workspaces: Workspace[] }>("/api/auth/me");
    setUser(me.user);
    setWorkspaces(me.workspaces);
    api.primeGet?.("/api/auth/me", me);
  }, [api]);

  const refreshEnvironments = useCallback(async (): Promise<void> => {
    if (!input.activeWorkspaceId) {
      setEnvironments([]);
      setHasLoadedEnvironments(false);
      return;
    }

    setNavError(null);
    setIsEnvironmentsLoading(true);
    try {
      const response = await api.get<{ items: Environment[] }>(`/api/workspaces/${input.activeWorkspaceId}/projects`);
      const sorted = sortEnvironments(response.items);
      setEnvironments(sorted);
      api.primeGet?.(`/api/workspaces/${input.activeWorkspaceId}/projects`, { items: sorted });
    } finally {
      setIsEnvironmentsLoading(false);
      setHasLoadedEnvironments(true);
    }
  }, [api, input.activeWorkspaceId]);

  const refreshTasks = useCallback(async (): Promise<void> => {
    if (!input.activeEnvironmentId) {
      setTasks([]);
      return;
    }

    setNavError(null);
    setIsTasksLoading(true);
    try {
      const response = await api.get<{ items: TaskSummary[] }>(`/api/projects/${input.activeEnvironmentId}/tasks`);
      setTasks(response.items);
      api.primeGet?.(`/api/projects/${input.activeEnvironmentId}/tasks`, response);
    } finally {
      setIsTasksLoading(false);
    }
  }, [api, input.activeEnvironmentId]);

  const refreshWorkspaceSettings = useCallback(async (): Promise<void> => {
    if (!input.activeWorkspaceId) {
      setWorkspaceSettings(null);
      return;
    }

    setIsWorkspaceSettingsLoading(true);
    try {
      const settings = await api.get<WorkspaceSettings>(`/api/workspaces/${input.activeWorkspaceId}/settings`);
      setWorkspaceSettings(settings);
      api.primeGet?.(`/api/workspaces/${input.activeWorkspaceId}/settings`, settings);
    } finally {
      setIsWorkspaceSettingsLoading(false);
    }
  }, [api, input.activeWorkspaceId]);

  async function createWorkspace(name: string): Promise<void> {
    const payload = await api.post<{ id: string; name: string; iconKey?: string }>("/api/workspaces", { name });
    api.invalidateGet?.();
    await refreshWorkspaces();
    saveLastWorkspaceId(payload.id);
    input.navigate(`/app/${payload.id}/projects`);
    input.setFlash({ tone: "success", text: "Workspace created." });
  }

  async function createEnvironment(name: string): Promise<void> {
    if (!input.activeWorkspaceId) {
      throw new Error("Select a workspace first");
    }

    const created = await api.post<{ id: string; name: string; rootPath?: string }>(
      `/api/workspaces/${input.activeWorkspaceId}/projects`,
      { name }
    );
    const createdAt = new Date().toISOString();
    api.invalidateGet?.({ pathPrefix: `/api/workspaces/${input.activeWorkspaceId}` });
    setEnvironments((current) =>
      upsertEnvironment(current, {
        id: created.id,
        workspace_id: input.activeWorkspaceId,
        name: created.name,
        status: "active",
        root_path: created.rootPath,
        created_at: createdAt,
        updated_at: createdAt
      })
    );
    setHasLoadedEnvironments(true);
    input.navigate(`/app/${input.activeWorkspaceId}/projects/${created.id}`);
    input.setFlash({ tone: "success", text: "Project created." });
    void refreshEnvironments().catch((error) => {
      setNavError(error instanceof Error ? error.message : String(error));
    });
  }

  async function patchEnvironment(
    environmentId: string,
    patch: { name?: string; status?: "active" | "archived" | "error"; jsonPayload?: Record<string, unknown> }
  ): Promise<void> {
    await api.patch(`/api/projects/${environmentId}`, patch);
    api.invalidateGet?.({ pathPrefix: `/api/projects/${environmentId}` });
    api.invalidateGet?.({ pathPrefix: `/api/workspaces/${input.activeWorkspaceId}` });
    await refreshEnvironments();
  }

  const applyBootstrapPayload = useCallback((payload: WorkspaceBootstrapResponse): void => {
    const sortedProjects = sortEnvironments(payload.projects);
    setUser(payload.user);
    setWorkspaces(payload.workspaces);
    setEnvironments(sortedProjects);
    setWorkspaceSettings(payload.workspaceSettings);
    setHasLoadedEnvironments(true);
    api.primeGet?.("/api/auth/me", {
      user: payload.user,
      workspaces: payload.workspaces
    });
    api.primeGet?.(`/api/workspaces/${input.activeWorkspaceId}/projects`, { items: sortedProjects });
    api.primeGet?.(`/api/workspaces/${input.activeWorkspaceId}/settings`, payload.workspaceSettings);
    if (payload.activeProject) {
      api.primeGet?.(`/api/projects/${payload.activeProject.id}`, payload.activeProject);
    }
  }, [api, input.activeWorkspaceId]);

  const bootstrapWorkspace = useCallback(async (projectId?: string | null): Promise<void> => {
    if (!input.activeWorkspaceId) {
      await refreshWorkspaces();
      return;
    }

    const searchParams = new URLSearchParams();
    if (projectId) {
      searchParams.set("projectId", projectId);
    }
    const bootstrapPath = `/api/workspaces/${input.activeWorkspaceId}/bootstrap${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    const cached = api.cachedGet?.<WorkspaceBootstrapResponse>(bootstrapPath, {
      ttlMs: API_CACHE_TTLS.workspaceMetadata
    });

    if (cached) {
      if (cached.data) {
        applyBootstrapPayload(cached.data);
      }
      const payload = await cached.promise;
      applyBootstrapPayload(payload);
      return;
    }

    const payload = await api.get<WorkspaceBootstrapResponse>(bootstrapPath);
    applyBootstrapPayload(payload);
  }, [
    api,
    applyBootstrapPayload,
    input.activeWorkspaceId,
    refreshWorkspaces
  ]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      setIsBootstrapping(true);
      setNavError(null);
      try {
        await bootstrapWorkspace(input.activeEnvironmentId);
      } catch (error) {
        if (!cancelled) {
          if (shouldLogoutForWorkspaceBootstrapError(error)) {
            input.onLogout();
            input.setFlash({ tone: "error", text: "Session expired. Please sign in again." });
          } else {
            const message = error instanceof Error ? error.message : "Could not load your workspace right now.";
            setNavError(message);
            input.setFlash({ tone: "error", text: message });
          }
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [api, bootstrapWorkspace, input.activeWorkspaceId, input.onLogout, input.setFlash]);

  useEffect(() => {
    if (isBootstrapping || workspaces.length === 0) {
      return;
    }

    const workspaceExists = workspaces.some((workspace) => workspace.id === input.activeWorkspaceId);
    if (!workspaceExists) {
      input.navigate(`/app/${workspaces[0].id}/projects`, { replace: true });
    }
  }, [input.activeWorkspaceId, input.navigate, isBootstrapping, workspaces]);

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    if (environments.length === 0) {
      setHasLoadedEnvironments(false);
    }
    void bootstrapWorkspace(input.activeEnvironmentId).catch((error) => {
      setNavError(error instanceof Error ? error.message : String(error));
    });
  }, [bootstrapWorkspace, input.activeEnvironmentId, input.activeWorkspaceId, isBootstrapping]);

  useEffect(() => {
    if (!input.activeEnvironmentId) {
      setTasks([]);
      return;
    }

    refreshTasks().catch((error) => {
      setNavError(error instanceof Error ? error.message : String(error));
    });
  }, [input.activeEnvironmentId, refreshTasks]);

  useEffect(() => {
    if (!input.activeEnvironmentId || !hasLoadedEnvironments || isEnvironmentsLoading) {
      return;
    }

    const currentExists = environments.some((environment) => environment.id === input.activeEnvironmentId);
    if (!currentExists && input.pathname.includes("/projects/")) {
      input.navigate(`/app/${input.activeWorkspaceId}/projects`, { replace: true });
    }
  }, [
    environments,
    hasLoadedEnvironments,
    input.activeEnvironmentId,
    input.activeWorkspaceId,
    input.navigate,
    input.pathname,
    isEnvironmentsLoading
  ]);

  return {
    api,
    user,
    workspaces,
    environments,
    tasks,
    workspaceSettings,
    isWorkspaceSettingsLoading,
    isBootstrapping,
    isEnvironmentsLoading,
    isTasksLoading,
    navError,
    activeWorkspace,
    activeEnvironment,
    refreshWorkspaces,
    refreshEnvironments,
    refreshTasks,
    refreshWorkspaceSettings,
    createWorkspace,
    createEnvironment,
    patchEnvironment,
    replaceSessionToken: input.onReplaceSessionToken
  };
}
