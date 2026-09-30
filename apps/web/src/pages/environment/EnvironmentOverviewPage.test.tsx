/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeContext } from "../../contexts/AppRuntimeContext";
import { WorkspaceContext } from "../../contexts/WorkspaceContext";
import type {
  PersistentShellSessionListResponse,
  TaskFolderSummary,
  TaskListResponse,
  WorkspaceContextValue
} from "../../lib/types";
import { EnvironmentOverviewPage } from "./EnvironmentOverviewPage";

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise
  };
}

function createRuntimeValue() {
  return {
    platform: {
      revealPath: vi.fn(),
      showQuickAgent: vi.fn(),
      getNotificationPermission: vi.fn(),
      showNotification: vi.fn(),
      saveActiveContext: vi.fn(),
      onNavigateRequested: vi.fn()
    },
    capabilities: {
      isDesktop: false,
      supportsRevealPath: false,
      supportsNativeDownloads: false,
      supportsServerProfiles: false
    },
    serverProfilesState: { profiles: [], activeProfileId: null },
    activeServerProfile: null,
    saveServerProfilesState: vi.fn(),
    shortcutPreferences: {},
    saveShortcutPreferences: vi.fn(),
    activeContext: { workspaceId: null, environmentId: null },
    saveActiveContext: vi.fn(),
    publicServerConfig: null,
    refreshPublicServerConfig: vi.fn()
  };
}

function createWorkspaceContextValue(
  responsePromise: Promise<TaskListResponse>,
  folders: TaskFolderSummary[] = [],
  persistentShells: PersistentShellSessionListResponse = { items: [] }
): WorkspaceContextValue {
  const apiGet = vi.fn(async (path: string): Promise<unknown> => {
    if (path.startsWith("/api/projects/proj-1/tasks")) {
      return responsePromise;
    }
    if (path === "/api/projects/proj-1/task-folders") {
      return { folders };
    }
    if (path === "/api/projects/proj-1/persistent-shell-sessions?includeOutput=false") {
      return persistentShells;
    }
    throw new Error(`Unexpected GET ${path}`);
  });

  return {
    api: {
      get: apiGet as unknown as WorkspaceContextValue["api"]["get"],
      cachedGet: (<T,>(path: string) => ({
        data: null,
        promise: apiGet(path) as Promise<T>,
        fromCache: false
      })) as WorkspaceContextValue["api"]["cachedGet"],
      peekGet: vi.fn(() => null),
      prefetchGet: (async <T,>() => ({} as T)) as WorkspaceContextValue["api"]["prefetchGet"],
      primeGet: vi.fn(),
      invalidateGet: vi.fn(),
      post: vi.fn(),
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    },
    token: "token",
    user: null,
    workspaces: [],
    projects: [
      {
        id: "proj-1",
        workspace_id: "ws-1",
        name: "Fast Project",
        status: "active",
        created_at: "2026-04-25T00:00:00.000Z",
        updated_at: "2026-04-25T00:00:00.000Z"
      }
    ],
    environments: [
      {
        id: "proj-1",
        workspace_id: "ws-1",
        name: "Fast Project",
        status: "active",
        created_at: "2026-04-25T00:00:00.000Z",
        updated_at: "2026-04-25T00:00:00.000Z"
      }
    ],
    tasks: [],
    workspaceSettings: null,
    isWorkspaceSettingsLoading: false,
    activeWorkspaceId: "ws-1",
    activeProjectId: "proj-1",
    activeEnvironmentId: "proj-1",
    isBootstrapping: false,
    isEnvironmentsLoading: false,
    isTasksLoading: false,
    setFlash: vi.fn(),
    refreshWorkspaces: vi.fn(async () => undefined),
    refreshProjects: vi.fn(async () => undefined),
    refreshEnvironments: vi.fn(async () => undefined),
    refreshTasks: vi.fn(async () => undefined),
    refreshWorkspaceSettings: vi.fn(async () => undefined),
    createWorkspace: vi.fn(async () => undefined),
    createProject: vi.fn(async () => undefined),
    createEnvironment: vi.fn(async () => undefined),
    patchProject: vi.fn(async () => undefined),
    patchEnvironment: vi.fn(async () => undefined),
    replaceSessionToken: vi.fn()
  };
}

describe("EnvironmentOverviewPage", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
        clear: vi.fn(() => values.clear())
      }
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("does not show false unavailable or empty task states before first task response", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const deferred = createDeferred<TaskListResponse>();

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <AppRuntimeContext.Provider value={createRuntimeValue() as never}>
            <WorkspaceContext.Provider value={createWorkspaceContextValue(deferred.promise)}>
              <EnvironmentOverviewPage />
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
    });

    expect(container.querySelector(".project-command-title h2")?.textContent).toBe("Tasks");
    expect(container.textContent).not.toContain("Loading tasks...");
    expect(container.textContent).not.toContain("Project unavailable");
    expect(container.textContent).not.toContain("No tasks match");

    await act(async () => {
      deferred.resolve({
        items: [],
        pagination: {
          page: 1,
          pageSize: 25,
          hasPreviousPage: false,
          hasNextPage: false,
          totalItems: 0,
          totalPages: 0
        }
      });
      await deferred.promise;
    });

    expect(container.textContent).toContain("No tasks match the current filters.");
  });

  it("renders task folders with nested task rows", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const taskResponse = Promise.resolve<TaskListResponse>({
      items: [
        {
          id: "task-1",
          title: "Write launch notes",
          status: "succeeded",
          created_at: "2026-05-22T00:00:00.000Z",
          updated_at: "2026-05-22T00:10:00.000Z",
          folder_id: "folder-1",
          folder_sort_order: 0,
          task_type: "standard"
        }
      ],
      pagination: {
        page: 1,
        pageSize: 25,
        hasPreviousPage: false,
        hasNextPage: false,
        totalItems: null,
        totalPages: null
      }
    });

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <AppRuntimeContext.Provider value={createRuntimeValue() as never}>
            <WorkspaceContext.Provider value={createWorkspaceContextValue(taskResponse, [
              {
                id: "folder-1",
                workspaceId: "ws-1",
                projectId: "proj-1",
                environmentId: "proj-1",
                parentFolderId: null,
                name: "Launch",
                sortOrder: 0,
                directTaskCount: 1,
                childFolderCount: 0,
                createdAt: "2026-05-22T00:00:00.000Z",
                updatedAt: "2026-05-22T00:00:00.000Z"
              }
            ])}>
              <EnvironmentOverviewPage />
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await taskResponse;
    });

    expect(container.textContent).toContain("Launch");
    expect(container.textContent).toContain("Write launch notes");
    expect(container.textContent).toContain("1 tasks");
  });

  it("shows the active background shell count only when a project has one", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const taskResponse = Promise.resolve<TaskListResponse>({
      items: [],
      pagination: {
        page: 1,
        pageSize: 25,
        hasPreviousPage: false,
        hasNextPage: false,
        totalItems: 0,
        totalPages: 0
      }
    });

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <AppRuntimeContext.Provider value={createRuntimeValue() as never}>
            <WorkspaceContext.Provider value={createWorkspaceContextValue(taskResponse, [], {
              items: [{
                id: "shell-1",
                status: "running",
                command: "npm run dev",
                workingDir: "/workspace",
                startedAt: "2026-09-02T01:00:00.000Z",
                updatedAt: "2026-09-02T01:01:00.000Z",
                output: null
              }]
            })}>
              <EnvironmentOverviewPage />
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await taskResponse;
      await Promise.resolve();
    });

    expect(container.textContent).toContain("1 active shell");
  });

});
