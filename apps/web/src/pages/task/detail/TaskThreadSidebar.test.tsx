/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { TaskConversationMessagesProps } from "../../../components/taskConversation/TaskConversationMessages";
import type { TaskDetail, TaskThreadSummary } from "../../../lib/types";
import type { UseTaskDetailEventsResult } from "./taskDetailEventTypes";
import { TaskThreadSidebar, type TaskThreadSidebarPanel } from "./TaskThreadSidebar";

const { useTaskDetailEventsMock } = vi.hoisted(() => ({
  useTaskDetailEventsMock: vi.fn((): UseTaskDetailEventsResult => ({
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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let lastThreadMessagesProps: TaskConversationMessagesProps | null = null;

vi.mock("./useTaskDetailEvents", () => ({
  useTaskDetailEvents: useTaskDetailEventsMock
}));

vi.mock("../../../hooks/useFileUpload", () => ({
  useFileUpload: () => ({
    attachments: [],
    uploadFiles: vi.fn(),
    removeAttachment: vi.fn(),
    toggleAttachmentForceInclude: vi.fn(),
    appendAttachments: vi.fn(),
    isUploading: false,
    pendingUploads: [],
    uploadError: null,
    clearAttachments: vi.fn()
  })
}));

vi.mock("../../../components/taskConversation/ChatInput", () => ({
  ChatInput: (props: {
    placeholder: string;
    isTaskRunning?: boolean;
    onStop?: () => void;
    onSubmit?: () => void;
    selectedAgentId?: string | null;
    onAgentChange?: (agentId: string) => void;
  }) => (
    <div data-testid="chat-input">
      {props.placeholder}
      <span data-testid="selected-agent">{props.selectedAgentId}</span>
      <button type="button" data-testid="select-thread-agent" onClick={() => props.onAgentChange?.("agent-2")}>
        Select thread agent
      </button>
      <button type="button" data-testid="submit-thread" onClick={props.onSubmit}>Submit</button>
      {props.isTaskRunning ? (
        <button type="button" data-testid="thread-stop" onClick={props.onStop}>
          Stop
        </button>
      ) : null}
    </div>
  )
}));

vi.mock("../../../components/modals/SourceFilePickerModal", () => ({
  SourceFilePickerModal: () => null
}));

vi.mock("../../../components/taskConversation/TaskConversationMessages", () => ({
  TaskConversationMessages: (props: TaskConversationMessagesProps) => {
    lastThreadMessagesProps = props;
    return (
      <div
        data-testid="thread-messages"
        data-thinking={props.showThinking ? "true" : "false"}
        data-live-count={String(props.liveToolCalls?.length ?? 0)}
        data-interrupting-count={String(props.interruptingLiveToolCallIds?.length ?? 0)}
      >
        {props.messages.map((message) => message.id).join(",")}
      </div>
    );
  }
}));

function createApi(input: {
  threads?: TaskThreadSummary[];
  taskDetail?: TaskDetail;
}): ApiClient {
  return {
    get: vi.fn(async (path: string) => {
      if (path.startsWith("/api/tasks/parent-task/threads")) {
        return { items: input.threads ?? [] };
      }
      if (path === "/api/tasks/thread-task") {
        return input.taskDetail;
      }
      return { items: [] };
    }),
    post: vi.fn()
  } as unknown as ApiClient;
}

function createThreadTaskDetail(status = "running", threadAgentId: string | null = null): TaskDetail {
  return {
    task: {
      id: "thread-task",
      title: "Investigate parser",
      status,
      workspace_id: "workspace-1",
      project_id: "project-1",
      environment_id: "project-1",
      cancellation_requested: false,
      resume_after_interrupt: false,
      created_at: "2026-05-04T10:00:00.000Z",
      updated_at: "2026-05-04T10:01:00.000Z",
      source: "web",
      task_root_path: ".meowbert/task-runs/thread-task",
      is_thread: true,
      thread_parent_task_id: "parent-task",
      thread_parent_message_id: "message-1",
      thread_selected_text: null,
      thread_agent_id: threadAgentId,
      task_type: "standard",
      default_timezone: "UTC",
      allow_waiting: true,
      schedule: null
    },
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        content_json: { text: "Working on it." },
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-05-04T10:00:30.000Z"
      }
    ],
    thread_counts: [],
    active_leaf_message_id: "assistant-1",
    runs: [],
    subtasks: [],
    latest_context_usage: null,
    workflow: null
  };
}

function renderSidebar(input: {
  api: ApiClient;
  stack: TaskThreadSidebarPanel[];
  availableAgents?: Array<{ id: string; name: string; description: string }>;
  selectedAgentId?: string | null;
  initialToolOptions?: {
    webSearch: boolean;
    memorySearch: boolean;
    scheduleTask: boolean;
    subtasks: boolean;
    computerUse: boolean;
    enabledSkills: string[];
    enabledSources: string[];
  };
  onOpenConversation?: (taskId: string, options?: {
    replaceTop?: boolean;
    parentMessageId?: string | null;
    selectedText?: { text: string; location: string | null } | null;
  }) => void;
}): {
  container: HTMLDivElement;
  root: Root;
  rerender: (nextInitialToolOptions: NonNullable<typeof input.initialToolOptions>) => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const initialToolOptions = input.initialToolOptions ?? {
    webSearch: false,
    memorySearch: true,
    scheduleTask: false,
    subtasks: false,
    computerUse: false,
    enabledSkills: [],
    enabledSources: []
  };

  function render(nextInitialToolOptions = initialToolOptions): void {
    act(() => {
    root.render(
      <TaskThreadSidebar
        api={input.api}
        token="token-1"
        activeProjectId="project-1"
        activeEnvironmentId="project-1"
        activeWorkspaceId="workspace-1"
        workspaceMemoryEnabled
        allowComputerUse
        availableSkills={[]}
        availableSources={[]}
        attachableSources={[]}
        availableAgents={input.availableAgents ?? []}
        defaultAgentId={null}
        selectedAgentId={input.selectedAgentId ?? null}
        showAgentSwitcher
        enableThreadSelectionPopup
        submitWithShiftEnter={false}
        initialToolOptions={nextInitialToolOptions}
        assistantMessageDisplayPreferences={{
          showThoughts: true,
          renderMarkdown: true,
          renderCommonHtml: true,
          hideCitationMarkers: true,
          renderUserMessages: false,
          renderLatex: true,
          allowSingleDollarLatex: false,
          collapseLongMessages: true,
          showMessageSummaries: true,
          showScrollToBottomButton: true,
          showSelectionThreadActions: true,
          showSelectionThreadHighlights: true
        }}
        stack={input.stack}
        onBack={vi.fn()}
        onClose={vi.fn()}
        onOpenList={vi.fn()}
        onOpenComposer={vi.fn()}
        onOpenConversation={input.onOpenConversation ?? vi.fn()}
        onRootRefreshRequested={vi.fn()}
      />
    );
    });
  }

  render();

  return { container, root, rerender: render };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("TaskThreadSidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    lastThreadMessagesProps = null;
    vi.clearAllMocks();
  });

  it("uses the shared task status badge in thread list rows", async () => {
    const onOpenConversation = vi.fn();
    const api = createApi({
      threads: [
        {
          task_id: "thread-task",
          parent_message_id: "message-1",
          title: "Investigate parser",
          status: "starting",
          created_at: "2026-05-04T10:00:00.000Z",
          updated_at: "2026-05-04T10:01:00.000Z",
          selected_text: "parse this",
          selected_text_location: "line 1:1 to line 1:11",
          latest_assistant_preview: "Taking a look."
        }
      ]
    });
    const { container, root } = renderSidebar({
      api,
      onOpenConversation,
      stack: [
        {
          kind: "list",
          taskId: "parent-task",
          parentMessageId: "message-1",
          parentTaskRootPath: ".meowbert/task-runs/parent-task"
        }
      ]
    });

    await flushEffects();

    expect(container.querySelector(".thread-list-item-status .task-status-text")?.textContent).toBe("Starting");
    expect(container.querySelector(".thread-list-item-status .task-status-icon-spinning")).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".thread-list-item")?.click();
    });
    expect(onOpenConversation).toHaveBeenCalledWith("thread-task", {
      parentMessageId: "message-1",
      selectedText: {
        text: "parse this",
        location: "line 1:1 to line 1:11"
      }
    });
    act(() => {
      root.unmount();
    });
  });

  it("filters the thread list to the selected text", async () => {
    const api = createApi({
      threads: [
        {
          task_id: "thread-match",
          parent_message_id: "message-1",
          title: "Matching thread",
          status: "succeeded",
          created_at: "2026-05-04T10:00:00.000Z",
          updated_at: "2026-05-04T10:01:00.000Z",
          selected_text: "parse this",
          selected_text_location: "line 1:1 to line 1:11",
          latest_assistant_preview: "Matched."
        },
        {
          task_id: "thread-other",
          parent_message_id: "message-1",
          title: "Other thread",
          status: "succeeded",
          created_at: "2026-05-04T10:00:00.000Z",
          updated_at: "2026-05-04T10:01:00.000Z",
          selected_text: "different text",
          selected_text_location: "line 2:1 to line 2:15",
          latest_assistant_preview: "Other."
        }
      ]
    });
    const { container, root } = renderSidebar({
      api,
      stack: [
        {
          kind: "list",
          taskId: "parent-task",
          parentMessageId: "message-1",
          parentTaskRootPath: ".meowbert/task-runs/parent-task",
          selectedTextFilter: {
            text: "parse this",
            location: "line 1:1 to line 1:11"
          }
        }
      ]
    });

    await flushEffects();

    expect(container.querySelector(".thread-sidebar-header-text strong")?.textContent).toBe("Selected text threads");
    expect(container.textContent).toContain("Matching thread");
    expect(container.textContent).not.toContain("Other thread");
    act(() => {
      root.unmount();
    });
  });

  it("passes the parent message when opening a thread conversation", async () => {
    const onOpenConversation = vi.fn();
    const api = createApi({
      threads: [
        {
          task_id: "thread-task",
          parent_message_id: "message-1",
          title: "Investigate parser",
          status: "succeeded",
          created_at: "2026-05-04T10:00:00.000Z",
          updated_at: "2026-05-04T10:01:00.000Z",
          selected_text: null,
          selected_text_location: null,
          latest_assistant_preview: null
        }
      ]
    });
    const { container, root } = renderSidebar({
      api,
      stack: [
        {
          kind: "list",
          taskId: "parent-task",
          parentMessageId: "message-1",
          parentTaskRootPath: ".meowbert/task-runs/parent-task"
        }
      ],
      onOpenConversation
    });

    await flushEffects();

    const threadItem = container.querySelector<HTMLButtonElement>(".thread-list-item");
    expect(threadItem).not.toBeNull();
    await act(async () => {
      threadItem?.click();
      await Promise.resolve();
    });

    expect(onOpenConversation).toHaveBeenCalledWith("thread-task", {
      parentMessageId: "message-1"
    });
    act(() => {
      root.unmount();
    });
  });

  it("passes thread event state into the reused conversation renderer", async () => {
    useTaskDetailEventsMock.mockReturnValue({
      events: [],
      notificationEvents: [],
      isEventsBootstrapping: false,
      isEventsPageLoading: false,
      liveToolCalls: [
        {
          id: "live-1",
          callId: "call-1",
          toolName: "shell",
          step: 1,
          command: "npm test",
          inputLabel: "npm test",
          inputText: "npm test",
          summary: null,
          interruptible: true,
          startedAt: "2026-05-04T10:00:30.000Z"
        }
      ],
      interruptingLiveToolCallIds: ["live-1"],
      isThinking: true,
      eventsFeedRef: { current: null },
      activateEventsTab: vi.fn(),
      handleEventsScroll: vi.fn(),
      handleInterruptLiveToolCall: vi.fn()
    });
    const api = createApi({ taskDetail: createThreadTaskDetail("running") });
    const { container, root } = renderSidebar({
      api,
      stack: [{ kind: "conversation", taskId: "thread-task" }]
    });

    await flushEffects();

    const headerStatus = container.querySelector(".thread-sidebar-status .task-status-text");
    const messages = container.querySelector("[data-testid='thread-messages']");
    expect(headerStatus?.textContent).toBe("Running");
    expect(messages?.getAttribute("data-thinking")).toBe("true");
    expect(messages?.getAttribute("data-live-count")).toBe("1");
    expect(messages?.getAttribute("data-interrupting-count")).toBe("1");
    act(() => {
      root.unmount();
    });
  });

  it("uses the shared GET cache for the initial thread conversation load", async () => {
    const taskDetail = createThreadTaskDetail("succeeded");
    const api = {
      cachedGet: vi.fn(() => ({
        data: null,
        promise: Promise.resolve(taskDetail),
        fromCache: false
      })),
      get: vi.fn(async () => {
        throw new Error("unexpected raw GET");
      }),
      post: vi.fn()
    } as unknown as ApiClient;
    const { container, root } = renderSidebar({
      api,
      stack: [{ kind: "conversation", taskId: "thread-task" }]
    });

    await flushEffects();

    expect(api.cachedGet).toHaveBeenCalledWith("/api/tasks/thread-task", { ttlMs: 5000 });
    expect(api.get).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='thread-messages']")?.textContent).toBe("assistant-1");
    act(() => {
      root.unmount();
    });
  });

  it("shows normal task controls for a running thread conversation", async () => {
    const api = createApi({ taskDetail: createThreadTaskDetail("running") });
    const { container, root } = renderSidebar({
      api,
      stack: [{ kind: "conversation", taskId: "thread-task" }]
    });

    await flushEffects();

    const stopButton = container.querySelector<HTMLButtonElement>("[data-testid='thread-stop']");
    expect(stopButton).not.toBeNull();
    await act(async () => {
      stopButton?.click();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith("/api/tasks/thread-task/cancel", {});
    act(() => {
      root.unmount();
    });
  });

  it("keeps a thread model selection when its parent rerenders", async () => {
    const initialToolOptions = {
      webSearch: false,
      memorySearch: true,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    };
    const api = createApi({ taskDetail: createThreadTaskDetail("succeeded") });
    const { container, root, rerender } = renderSidebar({
      api,
      stack: [{ kind: "conversation", taskId: "thread-task" }],
      initialToolOptions,
      selectedAgentId: "agent-1",
      availableAgents: [
        { id: "agent-1", name: "Default", description: "Default model" },
        { id: "agent-2", name: "Selected", description: "Selected model" }
      ]
    });

    await flushEffects();
    const selectButton = container.querySelector<HTMLButtonElement>("[data-testid='select-thread-agent']");
    await act(async () => {
      selectButton?.click();
    });
    expect(container.querySelector("[data-testid='selected-agent']")?.textContent).toBe("agent-2");

    rerender({ ...initialToolOptions });
    await flushEffects();

    expect(container.querySelector("[data-testid='selected-agent']")?.textContent).toBe("agent-2");
    act(() => {
      root.unmount();
    });
  });

  it("uses the thread model instead of the parent model when opening a created thread", async () => {
    const api = createApi({ taskDetail: createThreadTaskDetail("succeeded", "agent-2") });
    const { container, root } = renderSidebar({
      api,
      stack: [{ kind: "conversation", taskId: "thread-task" }],
      selectedAgentId: "agent-1",
      availableAgents: [
        { id: "agent-1", name: "Parent model", description: "Parent model" },
        { id: "agent-2", name: "Thread model", description: "Thread model" }
      ]
    });

    await flushEffects();

    expect(container.querySelector("[data-testid='selected-agent']")?.textContent).toBe("agent-2");
    act(() => {
      root.unmount();
    });
  });

  it("keeps a message agent while editing a thread and restores the reply agent on cancel", async () => {
    const detail = createThreadTaskDetail("succeeded", "agent-1");
    const message = {
      id: "user-1",
      role: "user" as const,
      content_json: { text: "Original request", agent: { id: "agent-2" } },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-05-04T10:00:00.000Z"
    };
    detail.messages = [message];
    detail.active_leaf_message_id = message.id;
    const api = createApi({ taskDetail: detail });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ activeLeafMessageId: "edited-1" });
    const { container, root } = renderSidebar({
      api,
      stack: [{ kind: "conversation", taskId: "thread-task" }],
      selectedAgentId: "agent-1",
      availableAgents: [
        { id: "agent-1", name: "Thread model", description: "" },
        { id: "agent-2", name: "Message model", description: "" }
      ]
    });
    await flushEffects();

    expect(container.querySelector("[data-testid='selected-agent']")?.textContent).toBe("agent-1");
    await act(async () => {
      lastThreadMessagesProps?.onEditRequested?.(message);
    });
    expect(container.querySelector("[data-testid='selected-agent']")?.textContent).toBe("agent-2");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Cancel edit")?.click();
    });
    expect(container.querySelector("[data-testid='selected-agent']")?.textContent).toBe("agent-1");

    await act(async () => {
      lastThreadMessagesProps?.onEditRequested?.(message);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='submit-thread']")?.click();
      await Promise.resolve();
    });
    expect(api.post).toHaveBeenCalledWith(
      "/api/tasks/thread-task/messages/user-1/edit",
      expect.objectContaining({ agent: { id: "agent-2" } })
    );
    act(() => root.unmount());
  });

  it("links a thread conversation to its standalone task page", async () => {
    const api = createApi({ taskDetail: createThreadTaskDetail("succeeded") });
    const { container, root } = renderSidebar({
      api,
      stack: [{ kind: "conversation", taskId: "thread-task" }]
    });

    await flushEffects();

    const openLink = container.querySelector<HTMLAnchorElement>("a[aria-label='Open thread']");
    expect(openLink?.getAttribute("href")).toBe("/app/workspace-1/projects/project-1/tasks/thread-task");
    expect(openLink?.getAttribute("target")).toBe("_blank");
    act(() => {
      root.unmount();
    });
  });
});
