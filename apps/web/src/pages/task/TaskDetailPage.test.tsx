/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeContext } from "../../contexts/AppRuntimeContext";
import { WorkspaceContext } from "../../contexts/WorkspaceContext";
import type { TaskConversationBranchOption, TaskDetail, TaskMessage, WorkspaceContextValue } from "../../lib/types";
import { readTaskConversationDrafts } from "../../task/taskConversationDrafts";
import { TaskDetailPage } from "./TaskDetailPage";
import type { UseTaskDetailConversationResult } from "./detail/taskDetailConversationTypes";

const {
  navigateMock,
  fetchTaskInlineFileTicketMock,
  buildTaskInlineFileUrlMock,
  useTaskInputCatalogMock,
  useFileUploadMock,
  useTaskDetailConversationMock,
  useTaskDetailEventsMock
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  fetchTaskInlineFileTicketMock: vi.fn(async () => "ticket-inline"),
  buildTaskInlineFileUrlMock: vi.fn(
    (taskId: string, ticket: string, relativePath: string) => `https://example.test/${taskId}/${ticket}/${relativePath}`
  ),
  useTaskInputCatalogMock: vi.fn(() => ({
    availableAgents: [] as Array<{ id: string; name: string; description: string }>,
    availableSkills: [],
    availableSources: [],
    attachableSources: [],
    defaultAgentId: null as string | null
  })),
  useFileUploadMock: vi.fn(() => ({
    attachments: [],
    uploadFiles: vi.fn(),
    removeAttachment: vi.fn(),
    isUploading: false,
    pendingUploads: [],
    uploadError: null,
    clearAttachments: vi.fn(),
    appendAttachments: vi.fn()
  })),
  useTaskDetailConversationMock: vi.fn((): UseTaskDetailConversationResult => ({
    messages: [] as TaskMessage[],
    outlineMessages: [] as TaskMessage[],
    branchOptionsByMessageId: {} as Record<string, TaskConversationBranchOption>,
    hydratedMessageIds: new Set<string>(),
    isConversationBootstrapping: false,
    isConversationPageLoading: false,
    conversationPageLoadDirection: null,
    chatFeedRef: { current: null },
    messagePage: {
      start_index: 0,
      end_index: 0,
      total_items: 0,
      has_older: false,
      has_newer: false
    },
    topbarCollapsed: false,
    isNearBottom: true,
    expandTopbar: vi.fn(),
    activateConversationTab: vi.fn(),
    handleConversationScroll: vi.fn(),
    handleConversationWheel: vi.fn(),
    handleToolGroupExpandRequested: vi.fn(),
    jumpToMessage: vi.fn(),
    jumpToMessageIndex: vi.fn(async () => undefined)
  })),
  useTaskDetailEventsMock: vi.fn(() => ({
    events: [],
    notificationEvents: [],
    isEventsBootstrapping: false,
    isEventsPageLoading: false,
    liveToolCalls: [],
    interruptingLiveToolCallIds: [],
    isThinking: false,
    eventsFeedRef: { current: null },
    activateEventsTab: vi.fn(),
    handleEventsScroll: vi.fn(),
    handleInterruptLiveToolCall: vi.fn()
  }))
}));

let lastConversationPaneProps: Record<string, unknown> | null = null;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("../../lib/taskInlineFiles", () => ({
  fetchTaskInlineFileTicket: fetchTaskInlineFileTicketMock,
  buildTaskInlineFileUrl: buildTaskInlineFileUrlMock
}));

vi.mock("../../hooks/useTaskInputCatalog", () => ({
  useTaskInputCatalog: useTaskInputCatalogMock
}));

vi.mock("../../hooks/useFileUpload", () => ({
  useFileUpload: useFileUploadMock
}));

vi.mock("./detail/useTaskDetailConversation", () => ({
  useTaskDetailConversation: useTaskDetailConversationMock
}));

vi.mock("./detail/useTaskDetailEvents", () => ({
  useTaskDetailEvents: useTaskDetailEventsMock
}));

vi.mock("./detail/TaskDetailTopbar", () => ({
  TaskDetailTopbar: (props: { task: { id: string; title: string | null } }) => (
    <div data-testid="task-topbar">{props.task.title ?? props.task.id}</div>
  )
}));

vi.mock("./detail/TaskDetailConversationPane", () => ({
  TaskDetailConversationPane: (props: Record<string, unknown>) => {
    lastConversationPaneProps = props;
    return <div data-testid="task-conversation">conversation:{String(props.taskId)}</div>;
  }
}));

vi.mock("./detail/TaskDetailEventsPane", () => ({
  TaskDetailEventsPane: () => <div data-testid="task-events" />
}));

vi.mock("./detail/TaskDetailNotificationsPane", () => ({
  TaskDetailNotificationsPane: () => <div data-testid="task-notifications" />
}));

vi.mock("./detail/TaskDetailArtifactsPane", () => ({
  TaskDetailArtifactsPane: () => <div data-testid="task-artifacts" />
}));

vi.mock("./detail/TaskThreadSidebar", () => ({
  buildThreadSidebarComposePanel: vi.fn(),
  TaskThreadSidebar: () => <div data-testid="task-thread-sidebar" />
}));

vi.mock("./detail/TaskMessageOutlinePanel", () => ({
  TaskMessageOutlinePanel: () => <div data-testid="task-outline" />
}));

vi.mock("./detail/TaskDetailWorkflowStrip", () => ({
  TaskDetailWorkflowStrip: () => <div data-testid="task-workflow-strip" />
}));

vi.mock("../../components/modals/ProjectFilePickerModal", () => ({
  ProjectFilePickerModal: () => null
}));

vi.mock("../../components/modals/SourceFilePickerModal", () => ({
  SourceFilePickerModal: () => null
}));

function createTaskDetail(input?: {
  workspaceId?: string;
  environmentId?: string;
  projectId?: string | null;
}): TaskDetail {
  return {
    task: {
      id: "task-1",
      title: "Route-loaded task",
      status: "queued",
      workspace_id: input?.workspaceId ?? "ws-route",
      ...(input?.projectId ? { project_id: input.projectId } : {}),
      environment_id: input?.environmentId ?? "proj-route",
      cancellation_requested: false,
      resume_after_interrupt: false,
      created_at: "2026-04-12T10:00:00.000Z",
      updated_at: "2026-04-12T10:00:00.000Z",
      source: "web",
      task_root_path: ".meowbert/task-runs/task-1",
      task_type: "standard",
      default_timezone: "UTC",
      allow_waiting: true,
      schedule: null
    },
    messages: [],
    thread_counts: [],
    active_leaf_message_id: null,
    runs: [],
    subtasks: [],
    latest_context_usage: null,
    workflow: null
  };
}

function createWorkspaceContextValue(): WorkspaceContextValue {
  const apiGet = vi.fn(async (path: string): Promise<unknown> => {
    if (path === "/api/tasks/task-1?messageDetail=none") {
      return createTaskDetail();
    }
    if (path === "/api/tasks/task-1/artifacts") {
      return { items: [] };
    }
    if (path === "/api/subscription") {
      return { mode: "free", usage: {} };
    }
    throw new Error(`Unexpected GET ${path}`);
  });

  return {
    api: {
      get: apiGet as unknown as WorkspaceContextValue["api"]["get"],
      cachedGet: ((path: string) => ({
        data: null,
        promise: apiGet(path) as Promise<unknown>,
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
    token: "token-1",
    user: null,
    workspaces: [],
    projects: [
      {
        id: "proj-route",
        workspace_id: "ws-route",
        name: "Route project",
        status: "active",
        root_path: "/tmp/project",
        created_at: "2026-04-12T10:00:00.000Z",
        updated_at: "2026-04-12T10:00:00.000Z"
      }
    ],
    environments: [
      {
        id: "proj-route",
        workspace_id: "ws-route",
        name: "Route project",
        status: "active",
        root_path: "/tmp/project",
        created_at: "2026-04-12T10:00:00.000Z",
        updated_at: "2026-04-12T10:00:00.000Z"
      }
    ],
    tasks: [],
    workspaceSettings: { memoryEnabled: false, modelDefaults: { newMessageOrganizationEnabled: false }, newMessageOrganizationEnabled: false } as unknown as WorkspaceContextValue["workspaceSettings"],
    isWorkspaceSettingsLoading: false,
    activeWorkspaceId: "ws-route",
    activeProjectId: null,
    activeEnvironmentId: null,
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

function createConversationMessage(id: string): TaskMessage {
  return {
    id,
    role: "user",
    content_json: { text: id },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-04-12T10:00:00.000Z"
  };
}

function createBranchOptions(): Record<string, TaskConversationBranchOption> {
  return {
    "message-1": {
      current_index: "1" as unknown as number,
      sibling_count: "2" as unknown as number,
      items: [
        { message_id: "message-1a", leaf_message_id: "leaf-a", index: "0" as unknown as number },
        { message_id: "message-1", leaf_message_id: "leaf-b", index: "1" as unknown as number }
      ]
    }
  };
}

function createConversationHookResult(
  overrides?: Partial<UseTaskDetailConversationResult>
): UseTaskDetailConversationResult {
  return {
    messages: [],
    outlineMessages: [],
    branchOptionsByMessageId: {},
    hydratedMessageIds: new Set<string>(),
    isConversationBootstrapping: false,
    isConversationPageLoading: false,
    conversationPageLoadDirection: null,
    chatFeedRef: { current: null },
    messagePage: {
      start_index: 0,
      end_index: 0,
      total_items: 0,
      has_older: false,
      has_newer: false
    },
    topbarCollapsed: false,
    isNearBottom: true,
    expandTopbar: vi.fn(),
    activateConversationTab: vi.fn(),
    handleConversationScroll: vi.fn(),
    handleConversationWheel: vi.fn(),
    handleToolGroupExpandRequested: vi.fn(),
    jumpToMessage: vi.fn(),
    jumpToMessageIndex: vi.fn(async () => undefined),
    ...overrides
  };
}

function createAppRuntimeValue() {
  return {
    platform: {
      saveUrlToFile: vi.fn(),
      revealPath: vi.fn(async () => ({ ok: true })),
      focusMainWindow: vi.fn()
    },
    capabilities: {
      isDesktop: false,
      supportsNativeDownloads: false,
      supportsRevealPath: false,
      supportsServerProfiles: false
    },
    serverProfilesState: { profiles: [], activeProfileId: null },
    activeServerProfile: null,
    saveServerProfilesState: vi.fn(async () => undefined),
    shortcutPreferences: {},
    saveShortcutPreferences: vi.fn(async () => undefined),
    activeContext: { workspaceId: null, environmentId: null },
    saveActiveContext: vi.fn(async () => undefined),
    publicServerConfig: null,
    refreshPublicServerConfig: vi.fn(async () => undefined)
  } as any;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("TaskDetailPage", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    get length() {
      return storage.size;
    },
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null)
  };

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", localStorageMock);
    Object.defineProperty(window, "localStorage", {
      writable: true,
      value: localStorageMock
    });
    lastConversationPaneProps = null;
    navigateMock.mockReset();
    fetchTaskInlineFileTicketMock.mockClear();
    buildTaskInlineFileUrlMock.mockClear();
    useTaskInputCatalogMock.mockClear();
    useFileUploadMock.mockClear();
    useTaskDetailConversationMock.mockClear();
    useTaskDetailEventsMock.mockClear();
    document.title = "Meowbert AI";

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
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
    vi.useRealTimers();
    storage.clear();
  });

  it("loads from route params even when no active project is selected yet", async () => {
    const workspaceContext = createWorkspaceContextValue();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    expect(container?.textContent).toContain("Route-loaded task");
    expect(container?.textContent).toContain("conversation:task-1");
    expect(container?.textContent).not.toContain("Couldn't resolve project context");
    expect(fetchTaskInlineFileTicketMock).toHaveBeenCalledWith("task-1", "token-1");
    expect(lastConversationPaneProps?.buildInlineArtifactUrl).toBeTypeOf("function");
    expect(
      (lastConversationPaneProps?.buildInlineArtifactUrl as ((relativePath: string) => string | null))("reports/summary.html")
    ).toBe("https://example.test/task-1/ticket-inline/reports/summary.html");
    expect(document.title).toBe("Route-loaded task · Route project · Meowbert AI");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps the edited message agent instead of the project default", async () => {
    const workspaceContext = createWorkspaceContextValue();
    useTaskInputCatalogMock.mockReturnValue({
      availableAgents: [
        { id: "default", name: "Default", description: "" },
        { id: "swarm", name: "Swarm", description: "" }
      ],
      availableSkills: [],
      availableSources: [],
      attachableSources: [],
      defaultAgentId: "default"
    });
    const message = {
      ...createConversationMessage("message-1"),
      content_json: { text: "Original request", agent: { id: "swarm" } }
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    expect(lastConversationPaneProps?.selectedAgentId).toBe("default");
    await act(async () => {
      (lastConversationPaneProps?.onEditRequested as (message: TaskMessage) => void)(message);
    });
    expect(lastConversationPaneProps?.selectedAgentId).toBe("swarm");

    await act(async () => {
      (lastConversationPaneProps?.onCancelEdit as () => void)();
    });
    expect(lastConversationPaneProps?.selectedAgentId).toBe("default");

    await act(async () => {
      (lastConversationPaneProps?.onEditRequested as (message: TaskMessage) => void)(message);
      await flushPromises();
    });
    await act(async () => {
      (lastConversationPaneProps?.onSubmit as () => void)();
      await flushPromises();
    });

    expect(workspaceContext.api.post).toHaveBeenCalledWith(
      "/api/tasks/task-1/messages/message-1/edit",
      expect.objectContaining({ agent: { id: "swarm" } })
    );
  });

  it("keeps the initial task-load error card compact in the full-height task route", async () => {
    const workspaceContext = createWorkspaceContextValue();
    const apiGet = workspaceContext.api.get as unknown as ReturnType<typeof vi.fn>;
    apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/task-1?messageDetail=none") {
        throw new Error("Rate limit exceeded, retry in 7 seconds");
      }
      if (path === "/api/tasks/task-1/artifacts") {
        return { items: [] };
      }
      if (path === "/api/subscription") {
        return { mode: "free", usage: {} };
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    const errorCard = container.querySelector(".task-load-error-card");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain("Rate limit exceeded, retry in 7 seconds");
    expect(errorCard?.querySelectorAll("button")).toHaveLength(2);
  });

  it("starts task snapshot and artifact requests in parallel", async () => {
    const workspaceContext = createWorkspaceContextValue();
    const apiGet = workspaceContext.api.get as unknown as ReturnType<typeof vi.fn>;
    const requestedPaths: string[] = [];
    let resolveTask: (value: TaskDetail) => void = () => {};
    let resolveArtifacts: (value: { items: [] }) => void = () => {};
    apiGet.mockImplementation((path: string) => {
      requestedPaths.push(path);
      if (path === "/api/tasks/task-1?messageDetail=none") {
        return new Promise((resolve) => {
          resolveTask = resolve;
        });
      }
      if (path === "/api/tasks/task-1/artifacts") {
        return new Promise((resolve) => {
          resolveArtifacts = resolve;
        });
      }
      if (path === "/api/subscription") {
        return Promise.resolve({ mode: "free", usage: {} });
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    expect(requestedPaths).toContain("/api/tasks/task-1?messageDetail=none");
    expect(requestedPaths).toContain("/api/tasks/task-1/artifacts");

    await act(async () => {
      resolveArtifacts({ items: [] });
      resolveTask(createTaskDetail());
      await flushPromises();
    });
  });

  it("redirects to the task's persisted environment id when the route project id is wrong", async () => {
    const workspaceContext = createWorkspaceContextValue();
    const apiGet = workspaceContext.api.get as unknown as ReturnType<typeof vi.fn>;
    apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/tasks/task-1?messageDetail=none") {
        return createTaskDetail({
          workspaceId: "ws-task",
          environmentId: "proj-task",
          projectId: null
        });
      }
      if (path === "/api/tasks/task-1/artifacts") {
        return { items: [] };
      }
      if (path === "/api/subscription") {
        return { mode: "free", usage: {} };
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    expect(navigateMock).toHaveBeenCalledWith("/app/ws-task/projects/proj-task/tasks/task-1", { replace: true });
  });

  it("renders and switches branches correctly when branch metadata is stringly typed", async () => {
    const workspaceContext = createWorkspaceContextValue();
    const apiPost = workspaceContext.api.post as unknown as ReturnType<typeof vi.fn>;
    useTaskDetailConversationMock.mockReturnValue(createConversationHookResult({
      messages: [createConversationMessage("message-1")],
      outlineMessages: [createConversationMessage("message-1")],
      branchOptionsByMessageId: createBranchOptions(),
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    const branchSwitcher = lastConversationPaneProps?.renderBranchSwitcher as ((message: TaskMessage) => JSX.Element | null);
    expect(branchSwitcher).toBeTypeOf("function");

    const branchContainer = document.createElement("div");
    document.body.appendChild(branchContainer);
    const branchRoot = createRoot(branchContainer);

    await act(async () => {
      branchRoot.render(branchSwitcher(createConversationMessage("message-1")));
      await flushPromises();
    });

    expect(branchContainer.textContent).toContain("Branch 2/2");

    const previousButton = branchContainer.querySelector('button[title="Previous branch"]');
    expect(previousButton).toBeTruthy();
    await act(async () => {
      previousButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(apiPost).toHaveBeenCalledWith("/api/tasks/task-1/branch-selection", { activeLeafMessageId: "leaf-a" });

    await act(async () => {
      branchRoot.unmount();
    });
    branchContainer.remove();
  });

  it("wires the scroll-to-bottom action through the existing message jump path", async () => {
    const workspaceContext = createWorkspaceContextValue();
    const jumpToMessage = vi.fn();
    useTaskDetailConversationMock.mockReturnValue(createConversationHookResult({
      messages: [
        createConversationMessage("message-1"),
        createConversationMessage("message-2")
      ],
      outlineMessages: [
        createConversationMessage("message-1"),
        createConversationMessage("message-2")
      ],
      isNearBottom: false,
      jumpToMessage
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    expect(lastConversationPaneProps?.onScrollToBottomRequested).toBeTypeOf("function");

    (lastConversationPaneProps?.onScrollToBottomRequested as () => void)();

    expect(jumpToMessage).toHaveBeenCalledWith("message-2");
  });

  it("debounces task reply draft persistence while typing", async () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    const workspaceContext = createWorkspaceContextValue();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/app/ws-route/projects/proj-route/tasks/task-1"]}>
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <WorkspaceContext.Provider value={workspaceContext}>
              <Routes>
                <Route path="/app/:workspaceId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
              </Routes>
            </WorkspaceContext.Provider>
          </AppRuntimeContext.Provider>
        </MemoryRouter>
      );
      await flushPromises();
    });

    expect(lastConversationPaneProps?.onFollowUpChange).toBeTypeOf("function");

    await act(async () => {
      (lastConversationPaneProps?.onFollowUpChange as (value: string) => void)("slow input");
      await flushPromises();
    });

    expect(readTaskConversationDrafts()).toEqual({});

    await act(async () => {
      vi.advanceTimersByTime(399);
      await flushPromises();
    });

    expect(readTaskConversationDrafts()).toEqual({});

    await act(async () => {
      vi.advanceTimersByTime(1);
      await flushPromises();
    });

    expect(readTaskConversationDrafts()["task:task-1"]?.message).toBe("slow input");
  });
});
