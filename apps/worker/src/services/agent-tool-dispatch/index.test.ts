import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ResponseOutputItem } from "openai/resources/responses/responses";
import { PDFDocument } from "pdf-lib";
import { dispatchResponseOutput, type ToolDispatchContext, type ToolDispatchState } from "./index.js";
import { appendMessage, consumeCommandInterruptForStep, queryTasks } from "../agent-db/index.js";
import {
  executeShellCommand,
} from "../runtime/shell.js";
import { markTaskArtifacts, unmarkTaskArtifacts } from "../agent/artifacts.js";
import { getAvailableSkills } from "../agent/skill-registry.js";
import { searchMemoryIndex } from "../memory/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { requestDesktopComputerAction } from "../computer/computer-use.js";
import { pdfToolTestUtils } from "./pdf.js";
import { VIEW_IMAGE_MAX_BYTES, VIEW_PDF_MAX_INPUT_BYTES } from "./view-limits.js";

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn(async () => "msg-1"),
  consumeCommandInterruptForStep: vi.fn(async () => false),
  isCancellationRequested: async () => false,
  queryTasks: vi.fn(async () => ({
    tasks: [],
    pagination: {
      page: 1,
      pageSize: 10,
      hasPreviousPage: false,
      hasNextPage: false,
      totalItems: null,
      totalPages: null
    }
  })),
  viewTaskHistory: async () => null
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn(async () => {})
}));

vi.mock("../agent/artifacts.js", () => ({
  markTaskArtifacts: vi.fn(async () => {}),
  unmarkTaskArtifacts: vi.fn(async () => {})
}));

vi.mock("../computer/computer-use.js", () => ({
  getDesktopComputerPresence: vi.fn(async () => ({
    sessionId: "desktop-session-1",
    connectedAt: "2026-03-11T00:00:00.000Z",
    lastSeenAt: "2026-03-11T00:00:00.000Z",
    status: {
      available: true,
      platform: "darwin",
      permissions: {
        accessibility: "granted",
        screenRecording: "granted"
      },
      display: {
        id: "display-1",
        label: "Primary display",
        width: 1440,
        height: 900,
        scaleFactor: 2,
        coordinateSpaceWidth: 1280,
        coordinateSpaceHeight: 800
      },
      cursor: {
        x: 0,
        y: 0
      },
      canTakeScreenshot: true,
      canControlComputer: true,
      requiresRestart: false,
      reason: null
    }
  })),
  requestDesktopComputerAction: vi.fn(async () => ({
    type: "computer_action_result",
    requestId: "req-1",
    taskId: "task-1",
    toolName: "computer_local_shell",
    ok: true,
    output: {
      command: "pwd",
      cwd: "/Users/alex",
      stdout: "/Users/alex\n",
      stderr: "",
      exitCode: 0,
      timedOut: false
    },
    observation: null,
    completedAt: "2026-03-11T00:00:00.000Z"
  }))
}));

vi.mock("../runtime/shell.js", () => ({
  executeShellCommand: vi.fn(async () => ({
      command: "true",
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      cwd: "/tmp/task",
      stateReset: false
    })),

}));

vi.mock("../agent/skill-registry.js", () => ({
  getAvailableSkills: vi.fn(() => [])
}));

vi.mock("../agent/mcp-client.js", () => ({
  callMcpTool: async () => "",
  parseSkillToolName: () => null
}));

vi.mock("../task-schedules/service.js", () => ({
  createRecurringTaskFromTool: async () => ({
    taskId: "task-created",
    runId: "run-created",
    mode: "scheduled",
    scheduleState: "active",
    repeat: "* * * * *",
    timezone: "UTC",
    nextRunAt: null
  }),
  editCurrentTaskSchedule: async () => ({
    mode: "scheduled",
    state: "active",
    repeat: "* * * * *",
    timezone: "UTC",
    nextRunAt: null
  }),
  pauseRecurringSchedule: async () => ({
    mode: "scheduled",
    state: "paused",
    repeat: "* * * * *",
    timezone: "UTC",
    nextRunAt: null
  }),
  applyInfiniteWait: async () => new Date().toISOString()
}));

vi.mock("../memory/index.js", () => ({
  searchMemoryIndex: vi.fn(async () => ({
    sync_status: {
      state: "ready",
      search_target: "generation",
      active_generation: "gen-1",
      detail: null,
      error: null,
      last_started_at: "2026-03-08T10:00:00.000Z",
      last_successful_at: "2026-03-08T10:00:01.000Z",
      updated_at: "2026-03-08T10:00:01.000Z"
    },
    items: [
      {
        id: "chunk-1",
        score: 0.9,
        text: "Saved preference: use pnpm",
        file_path: "/tmp/env/.memory/preferences.md",
        relative_path: ".memory/preferences.md",
        line_start: 1,
        line_end: 2
      }
    ]
  }))
}));

vi.mock("../tasks/subtasks.js", () => ({
  createSubtaskFromTool: async () => ({
    taskId: "11111111-1111-4111-8111-111111111111",
    title: "Subtask created",
    status: "awaiting_input",
    subtaskDepth: 1,
    taskRootPath: ".meowbert/task-runs/task-1/subtasks/11111111-1111-4111-8111-111111111111",
    createdAt: "2026-03-02T00:00:00.000Z"
  }),
  startSubtasksFromTool: async () => ({
    ok: true,
    timed_out: false,
    timeout_seconds: 3600,
    subtasks: [
      {
        task_id: "11111111-1111-4111-8111-111111111111",
        title: "Subtask created",
        status: "succeeded",
        completed_at: "2026-03-02T00:01:00.000Z",
        final_response: "done",
        exit_reason: "completed",
        error_summary: null,
        timed_out: false
      }
    ]
  })
}));

function createBaseContext(): ToolDispatchContext {
  return {
    runId: "run-1",
    taskId: "task-1",
    workspaceId: "ws-1",
    environmentId: "env-1",
    actorUserId: null,
    taskDir: "/tmp/task",
    envRoot: "/tmp/env",
    workspaceRoot: "/tmp/workspace",
    liveSyncFiles: [],
    sandbox: {} as never,
    shellEnvOverrides: {},
    shellNetworkEnabled: true,
    triggerSource: "web",
    connectorContextId: null,
    defaultTimezone: "UTC",
    runMode: "default",
    runToolOptions: {
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: false,
      computerUse: false,
      enabledSkills: [],
      enabledSources: []
    },
    shellToolMaxTimeoutMs: 86_400_000,
    modelType: "openai",
    imageDetail: "high",
    skillsRootDir: null,
    isSkillAdmin: false,
    isThreadTask: false,
    activeMcpConnections: new Map(),
    activeSkillTools: [],
    enableSkillById: async () => ({ doc: null, toolNames: [] }),
    getCurrentLeafMessageId: () => null,
    setCurrentLeafMessageId: () => {},
    assertNotCancelled: async () => {},
    cancellationSignal: undefined
  };
}

function createLongHorizonClarifyContext(): NonNullable<ToolDispatchContext["workflowContext"]> {
  return {
    workflowTaskId: "workflow-1",
    workflowType: "long_horizon",
    phase: "clarify",
    config: {},
    taskId: "task-1",
    taskDir: "/tmp/task",
    workspaceId: "ws-1",
    environmentId: "env-1",
    currentAgent: null,
    agents: [],
    planContent: null,
    runtime: {
      lastPassiveRefreshAtMs: 0,
      lastExplicitRefreshWorkflowMessageNo: 0,
      pendingChannelMessageSendAfterRefresh: false
    }
  };
}

function createSwarmLeaderContext(): NonNullable<ToolDispatchContext["workflowContext"]> {
  return {
    workflowTaskId: "leader-task",
    workflowType: "agent_swarm",
    phase: "active",
    config: { reviewRounds: 2 },
    taskId: "leader-task",
    taskDir: "/tmp/task",
    workspaceId: "ws-1",
    environmentId: "env-1",
    currentAgent: {
      id: "leader-agent",
      role: "leader",
      slot_index: 0,
      task_id: "leader-task",
      title: "Leader",
      status: "running",
      task_root_path: ".meowbert/task-runs/leader-task",
      last_inbox_refresh_message_no: 0,
      state_json: {}
    },
    agents: [
      {
        id: "leader-agent",
        role: "leader",
        slot_index: 0,
        task_id: "leader-task",
        title: "Leader",
        status: "running",
        task_root_path: ".meowbert/task-runs/leader-task",
        last_inbox_refresh_message_no: 0,
        state_json: {}
      },
      {
        id: "worker-agent-1",
        role: "worker",
        slot_index: 0,
        task_id: "worker-task-1",
        title: "Worker 1",
        status: "running",
        task_root_path: ".meowbert/task-runs/worker-task-1",
        last_inbox_refresh_message_no: 0,
        state_json: {}
      }
    ],
    planContent: null,
    swarm: {
      sharedDir: "/tmp/shared",
      channels: [],
      peerTaskDirs: [],
      globalChannelId: "global-channel",
      latestWorkflowMessageNo: 0,
      leaderGlobalMessageCount: 0,
      activeWorkerCount: 1,
      workerGlobalReportTaskIds: [],
      workerGlobalReportLabels: [],
      missingWorkerGlobalReportTaskIds: ["worker-task-1"],
      missingWorkerGlobalReportLabels: ["Worker 1"],
      workersStartedAt: "2026-08-17T08:00:00.000Z",
      completedReviewRounds: 0,
      finalReview: null
    },
    runtime: {
      lastPassiveRefreshAtMs: 0,
      lastExplicitRefreshWorkflowMessageNo: 0,
      pendingChannelMessageSendAfterRefresh: false
    }
  };
}

function createPngBuffer(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

async function createPdfBuffer(pageCount: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([200, 200]);
  }
  return Buffer.from(await pdf.save());
}

describe("dispatchResponseOutput", () => {
  it("passes run_shell timeout_seconds to the shell executor", async () => {
    vi.clearAllMocks();
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockClear();
    executeShellCommandMock.mockResolvedValueOnce({
        command: "sleep 1",
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        aborted: false,
        cwd: "/tmp/task",
        stateReset: false
      });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_run_shell",
        type: "function_call",
        name: "run_shell",
        call_id: "call_run_shell",
        arguments: JSON.stringify({
          command: "sleep 1",
          timeout_seconds: 42
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(executeShellCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "sleep 1",
        timeoutMs: 42000
      })
    );

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    expect(JSON.parse((outputItem as { output: string }).output)).not.toHaveProperty("command");
  });

  it("truncates run_shell output at the requested character limit and reports its full length", async () => {
    vi.clearAllMocks();
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockResolvedValueOnce({
        command: "printf abcdef",
        stdout: "abcdef",
        stderr: "warning",
        stdoutLength: 6,
        stderrLength: 7,
        exitCode: 0,
        timedOut: false,
        aborted: false,
        cwd: "/tmp/task",
        stateReset: false
      });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([{
      id: "fc_run_shell_output_limit",
      type: "function_call",
      name: "run_shell",
      call_id: "call_run_shell_output_limit",
      arguments: JSON.stringify({
        command: "printf abcdef",
        timeout_seconds: null,
        background: null,
        background_id: null,
        wait_seconds: null,
        limit_start: 2,
        limit_end: 2,
        stop: null
      }),
      status: "completed"
    }], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    const output = JSON.parse((outputItem as { output: string }).output) as { stdout: string; stderr: string };
    expect(output.stdout).toBe("ab\n...[truncated; full output length: 6 characters]\nef");
    expect(output.stderr).toBe("wa\n...[truncated; full output length: 7 characters]\nng");
  });

  it("strips ANSI color codes from run_shell output before formatting and persisting", async () => {
    vi.clearAllMocks();
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockResolvedValueOnce({
        command: "rg overlap",
        stdout: "\x1b[0m\x1b[32m21\x1b[0m: warn_\x1b[1m\x1b[31moverlap\x1b[0ms\n",
        stderr: "",
        stdoutLength: 46,
        stderrLength: 0,
        exitCode: 0,
        timedOut: false,
        aborted: false,
        cwd: "/tmp/task",
        stateReset: false
      });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([{
      id: "fc_run_shell_ansi",
      type: "function_call",
      name: "run_shell",
      call_id: "call_run_shell_ansi",
      arguments: JSON.stringify({
        command: "rg overlap",
        timeout_seconds: null,
        background: null,
        background_id: null,
        wait_seconds: null,
        limit_start: null,
        limit_end: null,
        stop: null
      }),
      status: "completed"
    }], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    const output = JSON.parse((outputItem as { output: string }).output) as { stdout: string; stderr: string };
    expect(output.stdout).toBe("21: warn_overlaps\n");
  });

  it("uses 10,000-character start and end run_shell output limits when limit_start and limit_end are null", async () => {
    vi.clearAllMocks();
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockResolvedValueOnce({
        command: "generate output",
        stdout: "a".repeat(20_001),
        stderr: "",
        stdoutLength: 20_001,
        stderrLength: 0,
        exitCode: 0,
        timedOut: false,
        aborted: false,
        cwd: "/tmp/task",
        stateReset: false
      });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([{
      id: "fc_run_shell_default_output_limit",
      type: "function_call",
      name: "run_shell",
      call_id: "call_run_shell_default_output_limit",
      arguments: JSON.stringify({
        command: "generate output",
        timeout_seconds: null,
        background: null,
        background_id: null,
        wait_seconds: null,
        limit_start: null,
        limit_end: null,
        stop: null
      }),
      status: "completed"
    }], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    const output = JSON.parse((outputItem as { output: string }).output) as { stdout: string };
    expect(output.stdout).toBe(
      `${"a".repeat(10_000)}\n...[truncated; full output length: 20001 characters]\n${"a".repeat(10_000)}`
    );
  });

  it("handles limit_start 0 and limit_end 0 correctly when truncating output", async () => {
    vi.clearAllMocks();
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockResolvedValueOnce({
        command: "generate output",
        stdout: "abcdef",
        stderr: "",
        stdoutLength: 6,
        stderrLength: 0,
        exitCode: 0,
        timedOut: false,
        aborted: false,
        cwd: "/tmp/task",
        stateReset: false
      });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([{
      id: "fc_run_shell_only_tail",
      type: "function_call",
      name: "run_shell",
      call_id: "call_run_shell_only_tail",
      arguments: JSON.stringify({
        command: "generate output",
        timeout_seconds: null,
        background: null,
        background_id: null,
        wait_seconds: null,
        limit_start: 0,
        limit_end: 2,
        stop: null
      }),
      status: "completed"
    }], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    const output = JSON.parse((outputItem as { output: string }).output) as { stdout: string };
    expect(output.stdout).toBe("...[truncated; full output length: 6 characters]\nef");
  });

  it("returns untruncated output when full length is within limit_start + limit_end", async () => {
    vi.clearAllMocks();
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockResolvedValueOnce({
        command: "generate output",
        stdout: "abcdef",
        stderr: "",
        stdoutLength: 6,
        stderrLength: 0,
        exitCode: 0,
        timedOut: false,
        aborted: false,
        cwd: "/tmp/task",
        stateReset: false
      });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([{
      id: "fc_run_shell_not_truncated",
      type: "function_call",
      name: "run_shell",
      call_id: "call_run_shell_not_truncated",
      arguments: JSON.stringify({
        command: "generate output",
        timeout_seconds: null,
        background: null,
        background_id: null,
        wait_seconds: null,
        limit_start: 3,
        limit_end: 3,
        stop: null
      }),
      status: "completed"
    }], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    const output = JSON.parse((outputItem as { output: string }).output) as { stdout: string };
    expect(output.stdout).toBe("abcdef");
  });

  it("passes computer_local_shell timeout_seconds through to the desktop broker", async () => {
    vi.clearAllMocks();
    const requestDesktopComputerActionMock = vi.mocked(requestDesktopComputerAction);
    requestDesktopComputerActionMock.mockClear();

    const ctx = createBaseContext();
    ctx.actorUserId = "user-1";
    ctx.runToolOptions.computerUse = true;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_computer_local_shell",
        type: "function_call",
        name: "computer_local_shell",
        call_id: "call_computer_local_shell",
        arguments: JSON.stringify({
          command: "pwd",
          timeout_seconds: 120
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    const outputItem = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_computer_local_shell"
    );
    expect(outputItem).toBeDefined();
    expect(JSON.parse((outputItem as { output: string }).output)).not.toHaveProperty("command");

    expect(requestDesktopComputerActionMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      taskId: "task-1",
      toolName: "computer_local_shell",
      args: {
        command: "pwd",
        timeout_seconds: 120
      },
      timeoutMs: 135000
    }));
  });

  it("does not re-dispatch a function tool call that already has output", async () => {
    vi.clearAllMocks();
    const requestDesktopComputerActionMock = vi.mocked(requestDesktopComputerAction);
    requestDesktopComputerActionMock.mockClear();

    const ctx = createBaseContext();
    ctx.actorUserId = "user-1";
    ctx.runToolOptions.computerUse = true;
    const state: ToolDispatchState = {
      conversationItems: [
        {
          type: "function_call_output",
          call_id: "call_computer_type_existing",
          output: JSON.stringify({ ok: true })
        }
      ],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_computer_type_existing",
        type: "function_call",
        name: "computer_type",
        call_id: "call_computer_type_existing",
        arguments: JSON.stringify({
          text: "wiki"
        }),
        status: "completed"
      }
    ];

    const result = await dispatchResponseOutput(outputItems, ctx, state);

    expect(result.sawToolCall).toBe(true);
    expect(result.sawFunctionToolCall).toBe(true);
    expect(requestDesktopComputerActionMock).not.toHaveBeenCalled();
    expect(state.runPersistedItems).toHaveLength(0);
  });

  it("dispatches memory_search and returns indexed chunks", async () => {
    vi.clearAllMocks();
    const memorySearchMock = vi.mocked(searchMemoryIndex);
    memorySearchMock.mockClear();
    const emitTaskEventMock = vi.mocked(emitTaskEvent);

    const ctx = createBaseContext();
    ctx.runToolOptions.memorySearch = true;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_memory_search",
        type: "function_call",
        name: "memory_search",
        call_id: "call_memory_search",
        arguments: JSON.stringify({
          query: "package manager preference",
          limit: 3
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(memorySearchMock).toHaveBeenCalledWith({
      workspaceRoot: "/tmp/workspace",
      currentProjectId: "env-1",
      query: "package manager preference",
      limit: 3,
      scope: "all",
      paths: null
    });
    expect(emitTaskEventMock).toHaveBeenNthCalledWith(1, "task-1", "command_start", expect.objectContaining({
      step: 0,
      callId: "call_memory_search",
      tool: "memory_search",
      inputLabel: "Query",
      inputText: "package manager preference"
    }));
    expect(emitTaskEventMock).toHaveBeenNthCalledWith(2, "task-1", "command_end", expect.objectContaining({
      step: 0,
      callId: "call_memory_search",
      tool: "memory_search",
      memoryResultCount: 1,
      memorySyncState: "ready"
    }));
    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    const outputJson = JSON.parse((outputItem as { output: string }).output) as { query?: string; items?: unknown[] };
    expect(outputJson.query).toBeUndefined();
    expect((outputItem as { output: string }).output).toContain("preferences.md");
  });

  it("persists memory_search failures and emits error events", async () => {
    vi.clearAllMocks();
    const memorySearchMock = vi.mocked(searchMemoryIndex);
    const emitTaskEventMock = vi.mocked(emitTaskEvent);
    memorySearchMock.mockRejectedValueOnce(new Error("index missing"));

    const ctx = createBaseContext();
    ctx.runToolOptions.memorySearch = true;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_memory_search_fail",
        type: "function_call",
        name: "memory_search",
        call_id: "call_memory_search_fail",
        arguments: JSON.stringify({
          query: "broken index",
          limit: 2
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(emitTaskEventMock).toHaveBeenNthCalledWith(1, "task-1", "command_start", expect.objectContaining({
      step: 0,
      callId: "call_memory_search_fail",
      tool: "memory_search",
      inputLabel: "Query",
      inputText: "broken index"
    }));
    expect(emitTaskEventMock).toHaveBeenNthCalledWith(2, "task-1", "command_end", expect.objectContaining({
      step: 0,
      callId: "call_memory_search_fail",
      tool: "memory_search",
      error: "Failed to search Memory: index missing"
    }));
    expect(emitTaskEventMock).toHaveBeenNthCalledWith(3, "task-1", "error", expect.objectContaining({
      message: "Failed to search Memory: index missing",
      step: 0,
      callId: "call_memory_search_fail",
      tool: "memory_search"
    }));

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    expect((outputItem as { output: string }).output).toContain("Failed to search Memory: index missing");
  });

  it("rejects view_image files whose bytes are not a valid image", async () => {
    vi.clearAllMocks();
    const emitTaskEventMock = vi.mocked(emitTaskEvent);

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-image-invalid-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "broken.png");
      fs.writeFileSync(filePath, "definitely not image bytes");

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_view_image_invalid",
          type: "function_call",
          name: "view_image",
          call_id: "call_view_image_invalid",
          arguments: JSON.stringify({ file_path: filePath }),
          status: "completed"
        }
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      const outputJson = JSON.parse((outputItem as { output: string }).output) as { error?: string };
      expect(outputJson.error).toContain("valid supported image");

      const hasInputImage = state.conversationItems.some((item) => {
        if (!("content" in item) || !Array.isArray(item.content)) {
          return false;
        }

        return item.content.some((contentItem) => {
          return typeof contentItem === "object" && contentItem !== null && "type" in contentItem && contentItem.type === "input_image";
        });
      });
      expect(hasInputImage).toBe(false);

      expect(emitTaskEventMock).toHaveBeenNthCalledWith(2, "task-1", "command_end", expect.objectContaining({
        tool: "view_image",
        error: expect.stringContaining("valid supported image")
      }));
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("marks only the explicit files passed to mark_artifact", async () => {
    vi.clearAllMocks();
    const emitTaskEventMock = vi.mocked(emitTaskEvent);
    const markTaskArtifactsMock = vi.mocked(markTaskArtifacts);

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-mark-artifact-"));
    ctx.taskDir = taskDir;

    try {
      const nestedDir = path.join(taskDir, "deliverables");
      fs.mkdirSync(nestedDir, { recursive: true });
      const filePath = path.join(nestedDir, "report.txt");
      fs.writeFileSync(filePath, "artifact contents");

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      await dispatchResponseOutput([
        {
          id: "fc_mark_artifact",
          type: "function_call",
          name: "mark_artifact",
          call_id: "call_mark_artifact",
          arguments: JSON.stringify({
            file_paths: ["deliverables/report.txt", filePath],
            remove: false
          }),
          status: "completed"
        }
      ], ctx, state);

      expect(markTaskArtifactsMock).toHaveBeenCalledWith("task-1", [
        {
          relativePath: "deliverables/report.txt",
          size: Buffer.byteLength("artifact contents")
        }
      ]);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      expect((outputItem as { output: string }).output).toContain("\"relative_path\":\"deliverables/report.txt\"");
      expect((outputItem as { output: string }).output).toContain("\"download_url\":\"/api/projects/env-1/files/download?path=deliverables%2Freport.txt\"");

      expect(emitTaskEventMock).toHaveBeenCalledWith("task-1", "artifact", {
        count: 1,
        files: [
          {
            relativePath: "deliverables/report.txt",
            sizeBytes: Buffer.byteLength("artifact contents")
          }
        ]
      });
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("constructs project-relative download_url when taskDir is nested under envRoot", async () => {
    vi.clearAllMocks();
    const markTaskArtifactsMock = vi.mocked(markTaskArtifacts);

    const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-env-root-"));
    const taskDir = path.join(envRoot, ".meowbert", "task-runs", "task-1");
    fs.mkdirSync(taskDir, { recursive: true });

    const ctx = createBaseContext();
    ctx.envRoot = envRoot;
    ctx.taskDir = taskDir;
    ctx.environmentId = "env-project-123";

    try {
      const filePath = path.join(taskDir, "summary.csv");
      fs.writeFileSync(filePath, "id,name\n1,test");

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      await dispatchResponseOutput([
        {
          id: "fc_mark_artifact_nested",
          type: "function_call",
          name: "mark_artifact",
          call_id: "call_mark_artifact_nested",
          arguments: JSON.stringify({
            file_paths: ["summary.csv"],
            remove: false
          }),
          status: "completed"
        }
      ], ctx, state);

      expect(markTaskArtifactsMock).toHaveBeenCalledWith("task-1", [
        {
          relativePath: "summary.csv",
          size: Buffer.byteLength("id,name\n1,test")
        }
      ]);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      const outputJson = JSON.parse((outputItem as { output: string }).output) as {
        ok: boolean;
        artifacts: Array<{ relative_path: string; size_bytes: number; download_url: string }>;
      };
      expect(outputJson.ok).toBe(true);
      expect(outputJson.artifacts).toEqual([
        {
          relative_path: "summary.csv",
          size_bytes: Buffer.byteLength("id,name\n1,test"),
          download_url: "/api/projects/env-project-123/files/download?path=.meowbert%2Ftask-runs%2Ftask-1%2Fsummary.csv"
        }
      ]);
    } finally {
      fs.rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it("unmarks explicit files when mark_artifact remove is true", async () => {
    vi.clearAllMocks();
    const emitTaskEventMock = vi.mocked(emitTaskEvent);
    const unmarkTaskArtifactsMock = vi.mocked(unmarkTaskArtifacts);

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-unmark-artifact-"));
    ctx.taskDir = taskDir;

    try {
      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      await dispatchResponseOutput([
        {
          id: "fc_mark_artifact",
          type: "function_call",
          name: "mark_artifact",
          call_id: "call_mark_artifact",
          arguments: JSON.stringify({
            file_paths: ["deliverables/report.txt", "deliverables/report.txt"],
            remove: true
          }),
          status: "completed"
        }
      ], ctx, state);

      expect(unmarkTaskArtifactsMock).toHaveBeenCalledWith("task-1", ["deliverables/report.txt"]);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      expect((outputItem as { output: string }).output).toContain("\"removed\":true");
      expect((outputItem as { output: string }).output).toContain("\"relative_path\":\"deliverables/report.txt\"");

      expect(emitTaskEventMock).toHaveBeenCalledWith("task-1", "artifact", {
        count: 0,
        removedCount: 1,
        removedFiles: [
          {
            relativePath: "deliverables/report.txt"
          }
        ]
      });
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("accepts valid image bytes even if the file extension is misleading", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-image-valid-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "actually-jpeg.jpg");
      fs.writeFileSync(filePath, createPngBuffer(8, 6));

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_view_image_valid",
          type: "function_call",
          name: "view_image",
          call_id: "call_view_image_valid",
          arguments: JSON.stringify({ file_path: filePath }),
          status: "completed"
        }
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      expect((outputItem as { output: string }).output).toContain('"ok":true');

      const imageItem = state.conversationItems.find((item) => {
        if (!("content" in item) || !Array.isArray(item.content)) {
          return false;
        }

        return item.content.some((contentItem) => {
          return typeof contentItem === "object" && contentItem !== null && "type" in contentItem && contentItem.type === "input_image";
        });
      }) as { content?: Array<{ type?: string; text?: string; image_url?: string }> } | undefined;

      expect(imageItem).toBeDefined();
      expect(imageItem?.content?.[0]).toEqual({
        type: "input_text",
        text: "Image file: actually-jpeg.jpg"
      });
      expect(imageItem?.content?.[1]?.image_url).toContain("data:image/png;base64,");
      expect((imageItem?.content?.[1] as { detail?: string } | undefined)?.detail).toBe("high");
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("uses original detail when detail is full and modelType is openai", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    ctx.modelType = "openai";
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-image-full-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "diagram.png");
      fs.writeFileSync(filePath, createPngBuffer(8, 6));

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_view_image_full",
          type: "function_call",
          name: "view_image",
          call_id: "call_view_image_full",
          arguments: JSON.stringify({ file_path: filePath, detail: "full" }),
          status: "completed"
        }
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      const imageItem = state.conversationItems.find((item) => {
        if (!("content" in item) || !Array.isArray(item.content)) {
          return false;
        }
        return item.content.some((contentItem) => {
          return typeof contentItem === "object" && contentItem !== null && "type" in contentItem && contentItem.type === "input_image";
        });
      }) as { content?: Array<{ type?: string; text?: string; image_url?: string; detail?: string }> } | undefined;

      expect(imageItem).toBeDefined();
      expect(imageItem?.content?.[1]?.detail).toBe("original");
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("silently ignores full detail when modelType is not openai (e.g. google)", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    ctx.modelType = "google";
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-image-google-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "diagram.png");
      fs.writeFileSync(filePath, createPngBuffer(8, 6));

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_view_image_google",
          type: "function_call",
          name: "view_image",
          call_id: "call_view_image_google",
          arguments: JSON.stringify({ file_path: filePath, detail: "full" }),
          status: "completed"
        }
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      const imageItem = state.conversationItems.find((item) => {
        if (!("content" in item) || !Array.isArray(item.content)) {
          return false;
        }
        return item.content.some((contentItem) => {
          return typeof contentItem === "object" && contentItem !== null && "type" in contentItem && contentItem.type === "input_image";
        });
      }) as { content?: Array<{ type?: string; text?: string; image_url?: string; detail?: string }> } | undefined;

      expect(imageItem).toBeDefined();
      expect(imageItem?.content?.[1]?.detail).toBe("high");
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("maps default detail to high for openai models", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    ctx.modelType = "openai";
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-image-default-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "diagram.png");
      fs.writeFileSync(filePath, createPngBuffer(8, 6));

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_view_image_default",
          type: "function_call",
          name: "view_image",
          call_id: "call_view_image_default",
          arguments: JSON.stringify({ file_path: filePath, detail: "default" }),
          status: "completed"
        }
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      const imageItem = state.conversationItems.find((item) => {
        if (!("content" in item) || !Array.isArray(item.content)) {
          return false;
        }
        return item.content.some((contentItem) => {
          return typeof contentItem === "object" && contentItem !== null && "type" in contentItem && contentItem.type === "input_image";
        });
      }) as { content?: Array<{ type?: string; text?: string; image_url?: string; detail?: string }> } | undefined;

      expect(imageItem).toBeDefined();
      expect(imageItem?.content?.[1]?.detail).toBe("high");
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("rejects oversized images before loading them into the worker process", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-image-too-large-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "huge.png");
      fs.writeFileSync(filePath, Buffer.alloc(VIEW_IMAGE_MAX_BYTES + 1, 0));

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      await dispatchResponseOutput([
        {
          id: "fc_view_image_large",
          type: "function_call",
          name: "view_image",
          call_id: "call_view_image_large",
          arguments: JSON.stringify({ file_path: filePath }),
          status: "completed"
        }
      ], ctx, state);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      expect((outputItem as { output: string }).output).toContain("viewer limit");
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("loads only the requested PDF page window and reports the full valid range", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-pdf-window-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "large.pdf");
      fs.writeFileSync(filePath, await createPdfBuffer(60));
      const subsetBuffer = await createPdfBuffer(50);
      const execFileSpy = vi.spyOn(pdfToolTestUtils.deps, "execFileText").mockImplementation(async (_command, args) => {
        const outputPath = String(args[3]);
        fs.writeFileSync(outputPath, subsetBuffer);
        return {
          stdout: JSON.stringify({
            effective_page_end: 50,
            effective_page_start: 1,
            message: "Loaded only pages 1-50. There are more pages outside this range; valid page range is 1-60.",
            total_pages: 60
          }),
          stderr: ""
        };
      });

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_view_pdf_window",
          type: "function_call",
          name: "view_pdf_file",
          call_id: "call_view_pdf_window",
          arguments: JSON.stringify({ file_path: filePath }),
          status: "completed"
        }
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      const outputJson = JSON.parse((outputItem as { output: string }).output) as {
        pages?: { start: number; end: number };
        total_pages?: number;
        message?: string;
      };
      expect(outputJson.pages).toEqual({ start: 1, end: 50 });
      expect(outputJson.total_pages).toBe(60);
      expect(outputJson.message).toContain("valid page range is 1-60");

      const fileItem = state.conversationItems.find((item) => {
        if (!("content" in item) || !Array.isArray(item.content)) {
          return false;
        }

        return item.content.some((contentItem) => {
          return typeof contentItem === "object" && contentItem !== null && "type" in contentItem && contentItem.type === "input_file";
        });
      }) as { content?: Array<{ type?: string; file_data?: string; filename?: string }> } | undefined;

      expect(fileItem).toBeDefined();
      expect(fileItem?.content?.[0]?.filename).toBe("large-pages-1-50.pdf");
      const dataUrl = fileItem?.content?.[0]?.file_data ?? "";
      const base64Payload = dataUrl.split(",", 2)[1] ?? "";
      const subsetPdf = await PDFDocument.load(Buffer.from(base64Payload, "base64"));
      expect(subsetPdf.getPageCount()).toBe(50);
      execFileSpy.mockRestore();
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("rejects view_pdf_file when the model disables PDF file viewing", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    ctx.compatibilityModes = ["disablePdfFile"];
    const execFileSpy = vi.spyOn(pdfToolTestUtils.deps, "execFileText");
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([
      {
        id: "fc_view_pdf_disabled",
        type: "function_call",
        name: "view_pdf_file",
        call_id: "call_view_pdf_disabled",
        arguments: JSON.stringify({ file_path: "/tmp/task/file.pdf" }),
        status: "completed"
      }
    ], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    expect((outputItem as { output: string }).output).toContain("view_pdf_file is disabled for this model");
    expect(execFileSpy).not.toHaveBeenCalled();
    execFileSpy.mockRestore();
  });

  it("does not add a more-pages message when the PDF range covers the full document", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-pdf-full-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "small.pdf");
      const fullBuffer = await createPdfBuffer(3);
      fs.writeFileSync(filePath, fullBuffer);
      const execFileSpy = vi.spyOn(pdfToolTestUtils.deps, "execFileText").mockImplementation(async (_command, args) => {
        const outputPath = String(args[3]);
        fs.writeFileSync(outputPath, fullBuffer);
        return {
          stdout: JSON.stringify({
            effective_page_end: 3,
            effective_page_start: 1,
            total_pages: 3
          }),
          stderr: ""
        };
      });

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_view_pdf_full",
          type: "function_call",
          name: "view_pdf_file",
          call_id: "call_view_pdf_full",
          arguments: JSON.stringify({ file_path: filePath }),
          status: "completed"
        }
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      const outputJson = JSON.parse((outputItem as { output: string }).output) as {
        pages?: { start: number; end: number };
        total_pages?: number;
        message?: string;
      };
      expect(outputJson.pages).toEqual({ start: 1, end: 3 });
      expect(outputJson.total_pages).toBe(3);
      expect(outputJson.message).toBeUndefined();

      const fileItem = state.conversationItems.find((item) => {
        if (!("content" in item) || !Array.isArray(item.content)) {
          return false;
        }

        return item.content.some((contentItem) => {
          return typeof contentItem === "object" && contentItem !== null && "type" in contentItem && contentItem.type === "input_file";
        });
      }) as { content?: Array<{ type?: string; filename?: string }> } | undefined;

      expect(fileItem).toBeDefined();
      expect(fileItem?.content?.[0]?.filename).toBe("small.pdf");
      execFileSpy.mockRestore();
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("rejects oversized PDFs before preparing them in the worker process", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-view-pdf-too-large-"));
    ctx.taskDir = taskDir;

    try {
      const filePath = path.join(taskDir, "huge.pdf");
      fs.writeFileSync(filePath, Buffer.alloc(VIEW_PDF_MAX_INPUT_BYTES + 1, 0));

      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      await dispatchResponseOutput([
        {
          id: "fc_view_pdf_too_large",
          type: "function_call",
          name: "view_pdf_file",
          call_id: "call_view_pdf_too_large",
          arguments: JSON.stringify({ file_path: filePath }),
          status: "completed"
        }
      ], ctx, state);

      const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
      expect(outputItem).toBeDefined();
      expect((outputItem as { output: string }).output).toContain("viewer limit");
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("rejects run_shell timeout_seconds values above the workspace shell timeout limit", async () => {
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockClear();

    const ctx = createBaseContext();
    ctx.shellToolMaxTimeoutMs = 30_000;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_run_shell_limit",
        type: "function_call",
        name: "run_shell",
        call_id: "call_run_shell_limit",
        arguments: JSON.stringify({
          command: "sleep 1",
          timeout_seconds: 31
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(executeShellCommandMock).not.toHaveBeenCalled();
    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    expect((outputItem as { output: string }).output).toContain("arguments are invalid");
  });

  it("rejects the removed background run_shell mode with migration guidance", async () => {
    vi.clearAllMocks();

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([
      {
        id: "fc_run_shell_background",
        type: "function_call",
        name: "run_shell",
        call_id: "call_run_shell_background",
        arguments: JSON.stringify({
          command: "npm run dev",
          timeout_seconds: null,
          background: true,
          background_id: null,
          wait_seconds: null,
          stop: null
        }),
        status: "completed"
      }
    ], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    expect((outputItem as { output: string }).output).toContain("persistent shell_session");
  });

  it("rejects legacy background output polling", async () => {
    vi.clearAllMocks();
    const ctx = createBaseContext();
    const backgroundCommand = {
      id: "bg-existing",
      command: "npm run dev",
      cwd: "/tmp/task",
      done: Promise.resolve()
    } as never;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0,
      backgroundShellCommands: new Map([["bg-existing", backgroundCommand]])
    };

    await dispatchResponseOutput([
      {
        id: "fc_run_shell_background_wait",
        type: "function_call",
        name: "run_shell",
        call_id: "call_run_shell_background_wait",
        arguments: JSON.stringify({
          command: null,
          timeout_seconds: null,
          background: null,
          background_id: "bg-existing",
          wait_seconds: 2,
          stop: null
        }),
        status: "completed"
      }
    ], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    expect((outputItem as { output: string }).output).toContain("persistent shell_session");
  });

  it("does not expose legacy background output limits", async () => {
    vi.clearAllMocks();
    const ctx = createBaseContext();
    const backgroundCommand = {
      id: "bg-output-limit",
      command: "generate output",
      cwd: "/tmp/task",
      done: Promise.resolve()
    } as never;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0,
      backgroundShellCommands: new Map([["bg-output-limit", backgroundCommand]])
    };

    await dispatchResponseOutput([{
      id: "fc_run_shell_background_output_limit",
      type: "function_call",
      name: "run_shell",
      call_id: "call_run_shell_background_output_limit",
      arguments: JSON.stringify({
        command: null,
        timeout_seconds: null,
        background: null,
        background_id: "bg-output-limit",
        wait_seconds: null,
        limit_start: 2,
        limit_end: 2,
        stop: null
      }),
      status: "completed"
    }], ctx, state);

    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect((outputItem as { output: string }).output).toContain("persistent shell_session");
  });

  it("rejects the removed shell_reset tool", async () => {
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
    await dispatchResponseOutput([{
      id: "fc_reset", type: "function_call", name: "shell_reset", call_id: "call_reset",
      arguments: "{}", status: "completed"
    }], createBaseContext(), state);
    const output = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect((output as { output: string }).output).toContain("Unknown tool");
  });

  it("refreshes the token used by subsequent fresh shell calls", async () => {

    const ctx = createBaseContext();
    ctx.refreshGitHubToken = vi.fn(async () => {
      ctx.shellEnvOverrides.GH_TOKEN = "ghs_refreshed";
      ctx.shellEnvOverrides.GITHUB_TOKEN = "ghs_refreshed";
      return {
        ok: true,
        login: "meowbert-bot",
        expiresAt: "2026-06-08T23:00:00.000Z"
      };
    });
    const shellSession = {} as never;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0,
      shellSession
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_refresh_gh_token",
        type: "function_call",
        name: "refresh_gh_token",
        call_id: "call_refresh_gh_token",
        arguments: JSON.stringify({}),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(ctx.refreshGitHubToken).toHaveBeenCalledTimes(1);
    expect(ctx.shellEnvOverrides.GH_TOKEN).toBe("ghs_refreshed");
    const outputItem = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_refresh_gh_token"
    ) as { output: string } | undefined;
    expect(outputItem).toBeDefined();
    expect(outputItem?.output).toContain('"ok":true');
  });

  it("returns an interrupted run_shell error when a command interrupt is requested", async () => {
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    const consumeInterruptMock = vi.mocked(consumeCommandInterruptForStep);
    executeShellCommandMock.mockClear();
    consumeInterruptMock.mockClear();

    consumeInterruptMock.mockResolvedValueOnce(true);
    executeShellCommandMock.mockImplementationOnce(async (input) => {
      return await new Promise((resolve) => {
        const finish = () => {
          resolve({
              command: input.command,
              stdout: "",
              stderr: "",
              exitCode: 130,
              timedOut: false,
              aborted: true,
              cwd: "/tmp/task",
              stateReset: true
            });
        };

        if (!input.abortSignal) {
          finish();
          return;
        }

        if (input.abortSignal.aborted) {
          finish();
          return;
        }

        input.abortSignal.addEventListener("abort", finish, { once: true });
      });
    });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };
    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_run_shell_interrupt",
        type: "function_call",
        name: "run_shell",
        call_id: "call_interrupt",
        arguments: JSON.stringify({ command: "sleep 10" }),
        status: "completed"
      }
    ];

    const result = await dispatchResponseOutput(outputItems, ctx, state);

    expect(result.sawFunctionToolCall).toBe(true);
    const outputItem = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    const outputJson = JSON.parse((outputItem as { output: string }).output) as {
      interrupted?: boolean;
      error?: string;
    };
    expect(outputJson.interrupted).toBe(true);
    expect(outputJson.error).toContain("interrupted");
  });

  it("returns a run_shell tool error instead of failing the task when shell execution throws", async () => {
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockClear();
    executeShellCommandMock.mockRejectedValueOnce(new Error("sandbox unavailable"));

    const ctx = createBaseContext();
    const existingSession = { mock: true } as never;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0,
      shellSession: existingSession
    };
    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_run_shell_error",
        type: "function_call",
        name: "run_shell",
        call_id: "call_run_shell_error",
        arguments: JSON.stringify({ command: "echo fail" }),
        status: "completed"
      }
    ];

    const result = await dispatchResponseOutput(outputItems, ctx, state);

    expect(result.sawFunctionToolCall).toBe(true);
    const outputItem = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_run_shell_error"
    ) as { output: string } | undefined;
    expect(outputItem).toBeDefined();
    const outputJson = JSON.parse(outputItem?.output ?? "{}") as {
      error?: string;
      stateReset?: boolean;
      exitCode?: number | null;
    };
    expect(outputJson.error).toContain("sandbox unavailable");
    expect(outputJson.stateReset).toBe(true);
    expect(outputJson.exitCode).toBeNull();
  });

  it("returns a fallback tool error when a handler throws before it can emit output", async () => {
    const emitTaskEventMock = vi.mocked(emitTaskEvent);
    emitTaskEventMock.mockClear();
    emitTaskEventMock.mockRejectedValueOnce(new Error("event boom"));

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };
    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_list_skills_error",
        type: "function_call",
        name: "list_skills",
        call_id: "call_list_skills_error",
        arguments: JSON.stringify({}),
        status: "completed"
      }
    ];

    const result = await dispatchResponseOutput(outputItems, ctx, state);

    expect(result.sawFunctionToolCall).toBe(true);
    const outputItem = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_list_skills_error"
    ) as { output: string } | undefined;
    expect(outputItem).toBeDefined();
    expect(outputItem?.output).toContain("Tool list_skills failed: event boom");
  });

  it("persists function_call_output for parse errors so function calls remain paired", async () => {
    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_bad",
        type: "function_call",
        name: "final_response",
        call_id: "call_bad",
        arguments: JSON.stringify({ notify: false }),
        status: "completed"
      }
    ];

    const result = await dispatchResponseOutput(outputItems, ctx, state);
    expect(result.sawFunctionToolCall).toBe(true);
    expect(result.finalResponse).toBeNull();

    const persistedFunctionCalls = state.runPersistedItems.filter((item) => item.type === "function_call");
    const persistedOutputs = state.runPersistedItems.filter((item) => item.type === "function_call_output");

    expect(persistedFunctionCalls).toHaveLength(1);
    expect(persistedOutputs).toHaveLength(1);
    expect((persistedOutputs[0] as { call_id: string }).call_id).toBe("call_bad");
  });

  it("tracks partial final_response calls without finishing the run", async () => {
    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_final_partial",
        type: "function_call",
        name: "final_response",
        call_id: "call_final_partial",
        arguments: JSON.stringify({ response: "Before the diagram.", notify: true, partial: true }),
        status: "completed"
      }
    ];

    const result = await dispatchResponseOutput(outputItems, ctx, state);

    expect(result.finalResponse).toEqual({
      response: "Before the diagram.",
      notify: true,
      partial: true
    });
    expect(state.finalResponseSegments).toEqual([result.finalResponse]);
  });

  it("rejects final_response before a Long Horizon review is approved", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "long_horizon_clarify";
    ctx.workflowContext = createLongHorizonClarifyContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const result = await dispatchResponseOutput([
      {
        id: "fc_final_before_review",
        type: "function_call",
        name: "final_response",
        call_id: "call_final_before_review",
        arguments: JSON.stringify({ response: "Skipped review.", notify: true, partial: false }),
        status: "completed"
      }
    ], ctx, state);

    expect(result.finalResponse).toBeNull();
    const output = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_final_before_review"
    ) as { output: string } | undefined;
    expect(output?.output).toContain("review approval is required");
  });

  it("accepts final_response when the Long Horizon review phase is disabled", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "long_horizon_main";
    ctx.workflowContext = {
      ...createLongHorizonClarifyContext(),
      phase: "working",
      longHorizon: {
        latestRound: 0,
        latestSubmissionMessage: null,
        latestSubmissionCreatedAt: null,
        reviewerCount: 0,
        currentReviewSummary: null,
        latestReviewRound: 0,
        approvedRound: null,
        tokenBudget: null,
        observedTokenUsage: 0,
        timeBudgetMinutes: null,
        elapsedSeconds: 0,
        remainingSeconds: null,
        isApproachingTimeLimit: false,
        enableClarifyPhase: true,
        enableReviewPhase: false,
        latestApprovalTally: null
      }
    };
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const result = await dispatchResponseOutput([
      {
        id: "fc_final_without_review",
        type: "function_call",
        name: "final_response",
        call_id: "call_final_without_review",
        arguments: JSON.stringify({ response: "Finished directly.", notify: true, partial: false }),
        status: "completed"
      }
    ], ctx, state);

    expect(result.finalResponse).toEqual({
      response: "Finished directly.",
      notify: true,
      partial: false
    });
  });

  it("asks a swarm leader without final peer review to retry final_response with force", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_leader";
    ctx.workflowContext = createSwarmLeaderContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const result = await dispatchResponseOutput([
      {
        id: "fc_swarm_final",
        type: "function_call",
        name: "final_response",
        call_id: "call_swarm_final",
        arguments: JSON.stringify({ response: "Swarm conclusion.", notify: true, partial: false }),
        status: "completed"
      }
    ], ctx, state);

    expect(result.finalResponse).toBeNull();
    const output = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_swarm_final"
    ) as { output: string } | undefined;
    expect(output?.output).toContain("force: true");
  });

  it("accepts a forced final_response from a swarm leader without final peer review", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_leader";
    ctx.workflowContext = createSwarmLeaderContext();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    const result = await dispatchResponseOutput([
      {
        id: "fc_swarm_forced_final",
        type: "function_call",
        name: "final_response",
        call_id: "call_swarm_forced_final",
        arguments: JSON.stringify({ response: "Swarm conclusion.", notify: true, partial: false, force: true }),
        status: "completed"
      }
    ], ctx, state);

    expect(result.finalResponse).toEqual({ response: "Swarm conclusion.", notify: true, partial: false });
  });

  it("rejects final_response from a swarm worker even when forced", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_worker";
    ctx.workflowContext = createSwarmLeaderContext();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    const result = await dispatchResponseOutput([{
      id: "fc_swarm_worker_final",
      type: "function_call",
      name: "final_response",
      call_id: "call_swarm_worker_final",
      arguments: JSON.stringify({ response: "Worker conclusion.", notify: true, partial: false, force: true }),
      status: "completed"
    }], ctx, state);

    expect(result.finalResponse).toBeNull();
    const output = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_swarm_worker_final"
    ) as { output: string } | undefined;
    expect(output?.output).toContain("Only the top Agent Swarm leader");
  });

  it("accepts final_response from a swarm leader after the final peer review", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_leader";
    ctx.workflowContext = createSwarmLeaderContext();
    ctx.workflowContext.swarm!.finalReview = {
      reviewerTaskId: "worker-task-1",
      reviewerLabel: "Worker 1",
      approved: true,
      summary: "Ready."
    };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    const result = await dispatchResponseOutput([
      {
        id: "fc_swarm_final_after_review",
        type: "function_call",
        name: "final_response",
        call_id: "call_swarm_final_after_review",
        arguments: JSON.stringify({ response: "Swarm conclusion.", notify: true, partial: false }),
        status: "completed"
      }
    ], ctx, state);

    expect(result.finalResponse).toEqual({ response: "Swarm conclusion.", notify: true, partial: false });
  });

  it("waits for started nested swarm output before ordinary final delivery", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_leader";
    ctx.workflowContext = createSwarmLeaderContext();
    ctx.workflowContext.swarm!.pendingNestedSwarmNodeIds = ["inner-node"];
    ctx.workflowContext.swarm!.finalReview = {
      reviewerTaskId: "worker-task-1", reviewerLabel: "Worker 1", approved: true, summary: "Ready."
    };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
    const result = await dispatchResponseOutput([{
      id: "fc_nested_pending", type: "function_call", name: "final_response",
      call_id: "call_nested_pending",
      arguments: JSON.stringify({ response: "Done.", notify: true, partial: false }),
      status: "completed"
    }], ctx, state);
    expect(result.finalResponse).toBeNull();
    const output = state.runPersistedItems.find((item) => item.type === "function_call_output"
      && item.call_id === "call_nested_pending") as { output: string } | undefined;
    expect(output?.output).toContain("inner-node");
  });

  it("rejects final_response from a spawned child-node leader", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_leader";
    ctx.workflowContext = { ...createSwarmLeaderContext(), workflowTaskId: "workflow-1" };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
    const result = await dispatchResponseOutput([{
      id: "fc_child_final", type: "function_call", name: "final_response",
      call_id: "call_child_final",
      arguments: JSON.stringify({ response: "Done.", notify: true, partial: false, force: true }),
      status: "completed"
    }], ctx, state);
    expect(result.finalResponse).toBeNull();
    const output = state.runPersistedItems.find((item) => item.type === "function_call_output"
      && item.call_id === "call_child_final") as { output: string } | undefined;
    expect(output?.output).toContain("submit_swarm_output");
  });

  it("records the swarm's final peer review", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_leader";
    ctx.workflowContext = createSwarmLeaderContext();
    const recordSwarmFinalReview = vi.fn(async () => ({ reviewerLabel: "Worker 1", approved: true }));
    ctx.workflowActions = { recordSwarmFinalReview };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput([
      {
        id: "fc_swarm_final_review",
        type: "function_call",
        name: "swarm_record_final_review",
        call_id: "call_swarm_final_review",
        arguments: JSON.stringify({ reviewer: "Worker 1", approved: true, summary: "Ready." }),
        status: "completed"
      }
    ], ctx, state);

    expect(recordSwarmFinalReview).toHaveBeenCalledWith({ reviewer: "Worker 1", approved: true, summary: "Ready." });
  });

  it("pauses Long Horizon clarify only through request_clarification", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "long_horizon_clarify";
    ctx.workflowContext = createLongHorizonClarifyContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const result = await dispatchResponseOutput([
      {
        id: "fc_request_clarification",
        type: "function_call",
        name: "request_clarification",
        call_id: "call_request_clarification",
        arguments: JSON.stringify({ question: "Which repository should I update?" }),
        status: "completed"
      }
    ], ctx, state);

    expect(result.workflowPause).toEqual({
      kind: "long_horizon_clarification_requested",
      response: "Which repository should I update?"
    });
  });

  it("lists only actor-visible skills for non-admin runs", async () => {
    const getAvailableSkillsMock = vi.mocked(getAvailableSkills);
    getAvailableSkillsMock.mockClear();
    getAvailableSkillsMock.mockReturnValueOnce([
      { id: "docx-studio", name: "DOCX Studio", description: "Docx tools" }
    ]);

    const ctx = createBaseContext();
    ctx.skillsRootDir = "/tmp/skills";
    ctx.isSkillAdmin = false;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_list_skills",
        type: "function_call",
        name: "list_skills",
        call_id: "call_list_skills",
        arguments: "{}",
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);
    expect(getAvailableSkillsMock).toHaveBeenCalledWith(
      "/tmp/skills",
      false,
      expect.objectContaining({ isSkillEnabled: expect.any(Function) })
    );
  });

  it("injects instruction-first skill guidance into the prompt when a skill adds no tools", async () => {
    const appendPromptDelta = vi.fn();
    const ctx = createBaseContext();
    ctx.appendPromptDelta = appendPromptDelta;
    ctx.enableSkillById = async () => ({
      doc: "# Guided learning\nTeach one idea at a time.",
      toolNames: []
    });
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_enable_skill",
        type: "function_call",
        name: "enable_skill",
        call_id: "call_enable_skill",
        arguments: JSON.stringify({ skill: "guided-learning" }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(appendPromptDelta).toHaveBeenCalledTimes(1);
    expect(appendPromptDelta).toHaveBeenCalledWith(expect.objectContaining({
      reason: "skill_enabled",
      role: "system"
    }));

    const outputItem = state.conversationItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_enable_skill"
    );
    expect(outputItem?.type).toBe("function_call_output");
  });

  it("lists admin-gated skills for admin runs", async () => {
    const getAvailableSkillsMock = vi.mocked(getAvailableSkills);
    getAvailableSkillsMock.mockClear();
    getAvailableSkillsMock.mockReturnValueOnce([
      { id: "browser-use", name: "Browser Use", description: "Playwright MCP browser automation" }
    ]);

    const ctx = createBaseContext();
    ctx.skillsRootDir = "/tmp/skills";
    ctx.isSkillAdmin = true;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_list_skills_admin",
        type: "function_call",
        name: "list_skills",
        call_id: "call_list_skills_admin",
        arguments: "{}",
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);
    expect(getAvailableSkillsMock).toHaveBeenCalledWith(
      "/tmp/skills",
      true,
      expect.objectContaining({ isSkillEnabled: expect.any(Function) })
    );
  });

  it("forwards full query_tasks filters and returns pagination", async () => {
    const queryTasksMock = vi.mocked(queryTasks);
    queryTasksMock.mockResolvedValueOnce({
      tasks: [
        {
          task_id: "task-2",
          title: "Investigate flaky test",
          status: "failed",
          created_at: "2026-02-28T10:00:00.000Z",
          updated_at: "2026-02-28T10:05:00.000Z",
          completed_at: "2026-02-28T10:05:00.000Z",
          trashed_at: null,
          task_type: "standard",
          schedule_state: null,
          schedule_next_run_at: null,
          schedule_timezone: null,
          schedule_repeat_cron: null,
          folder_id: null,
          latest_update: "Retried the suite; still flaky."
        }
      ],
      pagination: {
        page: 2,
        pageSize: 25,
        hasPreviousPage: true,
        hasNextPage: true,
        totalItems: null,
        totalPages: null
      }
    });

    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_search",
        type: "function_call",
        name: "query_tasks",
        call_id: "call_search",
        arguments: JSON.stringify({
          q: "flaky test",
          status: ["failed", "cancelled"],
          scope: "all",
          taskType: ["standard", "timed"],
          folder: "unfiled",
          sortBy: "updated_at",
          sortDir: "desc",
          page: 2,
          pageSize: 25
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(queryTasksMock).toHaveBeenCalledWith("task-1", "env-1", {
      query: "flaky test",
      status: ["failed", "cancelled"],
      scope: "all",
      taskType: ["standard", "timed"],
      folderId: null,
      folderMode: "unfiled",
      includePreview: true,
      sortBy: "updated_at",
      sortDir: "desc",
      page: 2,
      pageSize: 25
    });

    const toolOutputItem = state.conversationItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_search"
    ) as { output: string } | undefined;
    expect(toolOutputItem).toBeDefined();
    const parsed = JSON.parse(toolOutputItem?.output ?? "{}") as {
      tasks: unknown[];
      pagination: {
        page: number;
        pageSize: number;
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        totalItems: number | null;
        totalPages: number | null;
      };
      count: number;
    };
    expect(parsed.count).toBe(1);
    expect(parsed.pagination.hasNextPage).toBe(true);
  });

  it("lists tasks by recent activity when query_tasks has no keyword", async () => {
    const queryTasksMock = vi.mocked(queryTasks);
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput([
      {
        id: "fc_list",
        type: "function_call",
        name: "query_tasks",
        call_id: "call_list",
        arguments: JSON.stringify({
          q: null, status: ["running"], scope: null, taskType: null, folder: null,
          sortBy: "relevance", sortDir: null, page: null, pageSize: null
        }),
        status: "completed"
      }
    ], createBaseContext(), state);

    expect(queryTasksMock).toHaveBeenLastCalledWith("task-1", "env-1", expect.objectContaining({
      query: null,
      status: ["running"],
      sortBy: "updated_at"
    }));
  });

  it("still dispatches replayed search_task_history calls", async () => {
    const queryTasksMock = vi.mocked(queryTasks);
    queryTasksMock.mockClear();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput([
      {
        id: "fc_legacy",
        type: "function_call",
        name: "search_task_history",
        call_id: "call_legacy",
        arguments: JSON.stringify({ query: "deploy", limit: 5 }),
        status: "completed"
      }
    ], createBaseContext(), state);

    expect(queryTasksMock).toHaveBeenCalledWith("task-1", "env-1", expect.objectContaining({
      query: "deploy",
      pageSize: 5
    }));
  });

  it("creates and starts subtasks through function tools", async () => {
    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_create_subtask",
        type: "function_call",
        name: "create_subtask",
        call_id: "call_create_subtask",
        arguments: JSON.stringify({
          message: "Write tests",
          title: "Write tests",
          enabled_tools: {
            web_search: null,
            schedule_task: null,
            subtasks: null,
            enabled_skills: null
          }
        }),
        status: "completed"
      },
      {
        id: "fc_start_subtask",
        type: "function_call",
        name: "start_subtask",
        call_id: "call_start_subtask",
        arguments: JSON.stringify({
          task_ids: ["11111111-1111-4111-8111-111111111111"],
          timeout_seconds: null
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    const createdOutputItem = state.conversationItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_create_subtask"
    ) as { output: string } | undefined;
    expect(createdOutputItem).toBeDefined();
    const created = JSON.parse(createdOutputItem?.output ?? "{}") as { task_id: string };
    expect(created.task_id).toBe("11111111-1111-4111-8111-111111111111");

    const startOutputItem = state.conversationItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_start_subtask"
    ) as { output: string } | undefined;
    expect(startOutputItem).toBeDefined();
    const started = JSON.parse(startOutputItem?.output ?? "{}") as { ok: boolean; subtasks: Array<{ task_id: string }> };
    expect(started.ok).toBe(true);
    expect(started.subtasks[0]?.task_id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("pauses recurring tasks through stop_task and returns stop request", async () => {
    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_stop_task",
        type: "function_call",
        name: "stop_task",
        call_id: "call_stop_task",
        arguments: JSON.stringify({
          response: "All done for now. Pausing this recurring task.",
          notify: true
        }),
        status: "completed"
      }
    ];

    const result = await dispatchResponseOutput(outputItems, ctx, state);
    expect(result.stopRequest).toEqual({
      response: "All done for now. Pausing this recurring task.",
      notify: true
    });

    const outputItem = state.conversationItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_stop_task"
    ) as { output: string } | undefined;
    expect(outputItem).toBeDefined();
    const parsed = JSON.parse(outputItem?.output ?? "{}") as {
      acknowledged: boolean;
      schedule_state: string;
      mode: string;
    };
    expect(parsed.acknowledged).toBe(true);
    expect(parsed.schedule_state).toBe("paused");
    expect(parsed.mode).toBe("scheduled");
  });

  it("invalidates swarm send permission when another tool runs after refresh_inbox", async () => {
    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    ctx.workflowContext = {
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "leader-task",
      taskDir: "/tmp/task",
      workspaceId: "ws-1",
      environmentId: "env-1",
      currentAgent: {
        id: "leader-agent",
        role: "leader",
        slot_index: 0,
        task_id: "leader-task",
        title: "Leader",
        status: "running",
        task_root_path: ".meowbert/task-runs/leader-task",
        last_inbox_refresh_message_no: 0
      },
      agents: [],
      planContent: null,
      swarm: {
        sharedDir: "/tmp/shared",
        channels: [],
        peerTaskDirs: [],
        globalChannelId: "global-channel",
        latestWorkflowMessageNo: 12,
        leaderGlobalMessageCount: 0,
        activeWorkerCount: 0,
        workerGlobalReportTaskIds: [],
        workerGlobalReportLabels: [],
        missingWorkerGlobalReportTaskIds: [],
        missingWorkerGlobalReportLabels: [],
        workersStartedAt: null
      },
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 0,
        pendingChannelMessageSendAfterRefresh: false
      }
    } as NonNullable<ToolDispatchContext["workflowContext"]>;
    ctx.workflowActions = {
      refreshSwarmInbox: vi.fn(async () => {
        if (!ctx.workflowContext) {
          throw new Error("workflow context missing");
        }

        ctx.workflowContext.runtime.lastExplicitRefreshWorkflowMessageNo = 12;
        ctx.workflowContext.runtime.pendingChannelMessageSendAfterRefresh = true;
        return {
          delivered: false,
          latestWorkflowMessageNo: 12,
          unreadMessageCount: 0,
          bundleText: ""
        };
      }),
      listSwarmChannels: vi.fn(async () => []),
      sendSwarmChannelMessage: vi.fn(async () => {
        if (!ctx.workflowContext?.runtime.pendingChannelMessageSendAfterRefresh) {
          throw new Error("send blocked by tool order");
        }

        return {
          messageNo: 13,
          createdAt: "2026-03-18T00:00:13.000Z",
          paused: false
        };
      })
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_refresh_inbox",
        type: "function_call",
        name: "refresh_inbox",
        call_id: "call_refresh_inbox",
        arguments: "{}",
        status: "completed"
      },
      {
        id: "fc_list_channels",
        type: "function_call",
        name: "list_channels",
        call_id: "call_list_channels",
        arguments: "{}",
        status: "completed"
      },
      {
        id: "fc_send_channel_message",
        type: "function_call",
        name: "send_channel_message",
        call_id: "call_send_channel_message",
        arguments: JSON.stringify({
          channel_id: "global",
          message: "Kickoff",
          pause_after_send: false
        }),
        status: "completed"
      }
    ];

    await dispatchResponseOutput(outputItems, ctx, state);

    expect(ctx.workflowActions.refreshSwarmInbox).toHaveBeenCalledWith("explicit");
    expect(ctx.workflowActions.listSwarmChannels).toHaveBeenCalledTimes(1);
    expect(ctx.workflowActions.sendSwarmChannelMessage).toHaveBeenCalledTimes(1);
    expect(ctx.workflowContext.runtime.pendingChannelMessageSendAfterRefresh).toBe(false);

    const sendOutput = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_send_channel_message"
    ) as { output: string } | undefined;
    expect(sendOutput).toBeDefined();
    expect(sendOutput?.output).toContain("send blocked by tool order");
  });

  it("dispatches swarm_manage only through the swarm lifecycle action", async () => {
    const ctx = createBaseContext();
    const manageSwarmWorkers = vi.fn(async () => ({
      started: ["Worker 1"],
      stopped: ["Worker 2"],
      workers: [
        { taskId: "worker-1", label: "Worker 1", status: "queued", stopped: false, paused: false, pauseReason: null, waitingForTaskIds: [] },
        { taskId: "worker-2", label: "Worker 2", status: "cancelled", stopped: true, paused: false, pauseReason: null, waitingForTaskIds: [] }
      ],
      agents: [
        { taskId: "leader-1", label: "Leader", status: "running", stopped: false, paused: false, pauseReason: null, waitingForTaskIds: [] },
        { taskId: "worker-1", label: "Worker 1", status: "queued", stopped: false, paused: false, pauseReason: null, waitingForTaskIds: [] },
        { taskId: "worker-2", label: "Worker 2", status: "cancelled", stopped: true, paused: false, pauseReason: null, waitingForTaskIds: [] }
      ],
      waitCycleTaskIds: [],
      lastDetectedWaitCycleTaskIds: []
    }));
    ctx.workflowActions = { manageSwarmWorkers };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput([{
      id: "fc_swarm_manage",
      type: "function_call",
      name: "swarm_manage",
      call_id: "call_swarm_manage",
      arguments: JSON.stringify({ start: ["Worker 1"], stop: ["Worker 2"], grant_budget: [{ worker: "Worker 1", tokens: 2_000_000 }], view_only: false }),
      status: "completed"
    }], ctx, state);

    expect(manageSwarmWorkers).toHaveBeenCalledWith({
      start: ["Worker 1"], stop: ["Worker 2"], grantBudget: [{ worker: "Worker 1", tokens: 2_000_000 }], viewOnly: false
    });
    const output = state.runPersistedItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_swarm_manage"
    ) as { output: string } | undefined;
    expect(output?.output).toContain("Worker 1");
    expect(output?.output).toContain("worker-2");
  });

  it("passes a reminder to the model after three identical swarm or shell calls", async () => {
    const ctx = createBaseContext();
    ctx.workflowActions = { manageSwarmWorkers: async () => ({
      started: [], stopped: [], workers: [], agents: [],
      waitCycleTaskIds: [], lastDetectedWaitCycleTaskIds: []
    }) };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
    const call = (name: string, args: object, index: number): ResponseOutputItem => ({
      id: `fc_repeat_${index}`, type: "function_call", name,
      call_id: `call_repeat_${index}`, arguments: JSON.stringify(args), status: "completed"
    });

    for (let index = 1; index <= 3; index += 1) {
      await dispatchResponseOutput([call("swarm_manage", { start: [], stop: [], grant_budget: [], view_only: true }, index)], ctx, state);
    }
    const rosterOutput = state.conversationItems.find(
      (item) => item.type === "function_call_output" && item.call_id === "call_repeat_3"
    ) as { output: string } | undefined;
    expect(JSON.parse(rosterOutput?.output ?? "null")).toMatchObject({ ok: true, workers: [] });
    expect(state.conversationItems.filter((item) => item.role === "developer")).toHaveLength(1);
    expect(state.runPersistedItems.filter((item) => item.role === "developer")).toHaveLength(1);

    const statusArgs = {
      action: "status", session_id: "ad4fac81-2ac5-4251-a3c2-fa48e6595c7c",
      command: null, tail_lines: 120, save_output_path: null
    };
    for (let index = 4; index <= 6; index += 1) {
      await dispatchResponseOutput([call("shell_session", statusArgs, index)], ctx, state);
    }
    const reminders = state.conversationItems.filter((item) => item.role === "developer");
    expect(reminders).toHaveLength(2);
    expect(reminders[1]).toMatchObject({ content: expect.stringContaining("`wait`") });
  });

  it("pauses a swarm run without scheduling a dependency wait", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_worker";
    ctx.workflowContext = createSwarmLeaderContext();
    const pauseSwarmAgent = vi.fn(async () => {});
    ctx.workflowActions = { pauseSwarmAgent };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    const result = await dispatchResponseOutput([{
      id: "fc_swarm_pause",
      type: "function_call",
      name: "swarm_pause",
      call_id: "call_swarm_pause",
      arguments: JSON.stringify({ status: "Finished my current work.", waiting_for_task_ids: ["leader-1"] }),
      status: "completed"
    }], ctx, state);

    expect(pauseSwarmAgent).toHaveBeenCalledWith({ status: "Finished my current work.", waitingForTaskIds: ["leader-1"] });
    expect(result.workflowPause).toEqual({ kind: "agent_swarm_paused", response: "Finished my current work." });
  });

  it("pauses a swarm run with message text when send_channel_message has pause_after_send true", async () => {
    const ctx = createBaseContext();
    ctx.runMode = "agent_swarm_leader";
    ctx.workflowContext = createSwarmLeaderContext();
    ctx.workflowContext.runtime.pendingChannelMessageSendAfterRefresh = true;
    const sendSwarmChannelMessage = vi.fn(async () => ({
      messageNo: 42,
      createdAt: "2026-08-29T08:00:00.000Z",
      paused: true
    }));
    ctx.workflowActions = { sendSwarmChannelMessage };
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    const result = await dispatchResponseOutput([{
      id: "fc_send_channel_message",
      type: "function_call",
      name: "send_channel_message",
      call_id: "call_send_channel_message",
      arguments: JSON.stringify({
        channel_id: "global",
        message: "Candidate ready for review.",
        pause_after_send: true,
        waiting_for_task_ids: ["worker-1"]
      }),
      status: "completed"
    }], ctx, state);

    expect(sendSwarmChannelMessage).toHaveBeenCalledWith({
      channelId: "global",
      message: "Candidate ready for review.",
      pauseAfterSend: true,
      waitingForTaskIds: ["worker-1"]
    });
    expect(result.workflowPause).toEqual({
      kind: "agent_swarm_paused",
      response: "Candidate ready for review."
    });
  });

  it("throws TASK_CANCELLED before dispatching tool calls when interrupt is active", async () => {
    const executeShellCommandMock = vi.mocked(executeShellCommand);
    executeShellCommandMock.mockClear();

    const ctx = createBaseContext();
    ctx.assertNotCancelled = async () => {
      throw new Error("TASK_CANCELLED");
    };
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const outputItems: ResponseOutputItem[] = [
      {
        id: "fc_run_shell",
        type: "function_call",
        name: "run_shell",
        call_id: "call_run_shell",
        arguments: JSON.stringify({
          command: "echo should-not-run",
          timeout_seconds: 5
        }),
        status: "completed"
      }
    ];

    await expect(dispatchResponseOutput(outputItems, ctx, state)).rejects.toThrow("TASK_CANCELLED");
    expect(executeShellCommandMock).not.toHaveBeenCalled();
    expect(state.conversationItems).toHaveLength(0);
    expect(state.runPersistedItems).toHaveLength(0);
  });
});

describe("dispatchResponseOutput apply_patch", () => {
  it("applies Codex-style patches from custom tool calls and returns custom_tool_call_output items", async () => {
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-custom-"));
    const targetFile = path.join(taskRoot, "notes.txt");
    fs.writeFileSync(targetFile, "alpha\nbeta\n", "utf8");

    try {
      const ctx = createBaseContext();
      ctx.taskDir = taskRoot;
      ctx.envRoot = taskRoot;
      ctx.workspaceRoot = taskRoot;
      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "ctc_apply_patch_1",
          type: "custom_tool_call",
          name: "apply_patch",
          call_id: "call_patch_custom_1",
          input: [
            "*** Begin Patch",
            "*** Update File: notes.txt",
            "@@",
            "-alpha",
            "+gamma",
            " beta",
            "*** End Patch"
          ].join("\n")
        } as unknown as ResponseOutputItem
      ];

      const result = await dispatchResponseOutput(outputItems, ctx, state);
      const customOutput = state.runPersistedItems.find(
        (item) => item.type === "custom_tool_call_output" && item.call_id === "call_patch_custom_1"
      );

      expect(result.sawToolCall).toBe(true);
      expect(result.sawFunctionToolCall).toBe(true);
      expect(fs.readFileSync(targetFile, "utf8")).toBe("gamma\nbeta\n");
      expect(state.runPersistedItems).toContainEqual(expect.objectContaining({
        type: "custom_tool_call",
        call_id: "call_patch_custom_1",
        name: "apply_patch"
      }));
      expect(customOutput).toEqual(expect.objectContaining({
        type: "custom_tool_call_output",
        call_id: "call_patch_custom_1"
      }));
      expect(JSON.parse((customOutput as { output: string }).output)).toEqual({
        result: "Updated notes.txt",
        context: expect.stringContaining("input-token usage")
      });
      expect(appendMessage).toHaveBeenCalledWith(
        ctx.taskId,
        "tool",
        expect.objectContaining({
          tool: "apply_patch",
          callId: "call_patch_custom_1",
          stdout: "Updated notes.txt"
        }),
        expect.anything()
      );
    } finally {
      fs.rmSync(taskRoot, { recursive: true, force: true });
    }
  });

  it("applies Codex-style patches from function tool calls and returns function_call_output items", async () => {
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-function-"));
    const targetFile = path.join(taskRoot, "notes.txt");
    fs.writeFileSync(targetFile, "alpha\nbeta\n", "utf8");

    try {
      const ctx = createBaseContext();
      ctx.taskDir = taskRoot;
      ctx.envRoot = taskRoot;
      ctx.workspaceRoot = taskRoot;
      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "fc_apply_patch_1",
          type: "function_call",
          name: "apply_patch",
          call_id: "call_patch_function_1",
          arguments: JSON.stringify({
            patch: [
              "*** Begin Patch",
              "*** Update File: notes.txt",
              "@@",
              "-alpha",
              "+gamma",
              " beta",
              "*** End Patch"
            ].join("\n")
          }),
          status: "completed"
        }
      ];

      const result = await dispatchResponseOutput(outputItems, ctx, state);
      const functionOutput = state.runPersistedItems.find(
        (item) => item.type === "function_call_output" && item.call_id === "call_patch_function_1"
      );

      expect(result.sawToolCall).toBe(true);
      expect(result.sawFunctionToolCall).toBe(true);
      expect(fs.readFileSync(targetFile, "utf8")).toBe("gamma\nbeta\n");
      expect(functionOutput).toEqual(expect.objectContaining({
        type: "function_call_output",
        call_id: "call_patch_function_1"
      }));
      expect(JSON.parse((functionOutput as { output: string }).output)).toEqual({
        result: "Updated notes.txt",
        context: expect.stringContaining("input-token usage")
      });
      expect(appendMessage).toHaveBeenCalledWith(
        ctx.taskId,
        "tool",
        expect.objectContaining({
          tool: "apply_patch",
          callId: "call_patch_function_1",
          stdout: "Updated notes.txt"
        }),
        expect.anything()
      );
    } finally {
      fs.rmSync(taskRoot, { recursive: true, force: true });
    }
  });

  it("returns a custom output for an unsupported custom tool instead of leaving an orphaned call", async () => {
    const ctx = createBaseContext();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const result = await dispatchResponseOutput([{
      type: "custom_tool_call",
      name: "unexpected_custom_tool",
      call_id: "ctc_unsupported_1",
      input: "{}"
    } as unknown as ResponseOutputItem], ctx, state);

    expect(result.sawToolCall).toBe(true);
    expect(result.sawFunctionToolCall).toBe(true);
    expect(state.runPersistedItems).toContainEqual(expect.objectContaining({
      type: "custom_tool_call",
      call_id: "ctc_unsupported_1"
    }));
    expect(state.runPersistedItems).toContainEqual(expect.objectContaining({
      type: "custom_tool_call_output",
      call_id: "ctc_unsupported_1",
      output: expect.stringContaining("Unsupported custom tool")
    }));
  });

  it("still supports legacy apply_patch_call items", async () => {
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-"));
    const targetFile = path.join(taskRoot, "notes.txt");
    fs.writeFileSync(targetFile, "alpha\nbeta\n", "utf8");

    try {
      const ctx = createBaseContext();
      ctx.taskDir = taskRoot;
      ctx.envRoot = taskRoot;
      ctx.workspaceRoot = taskRoot;
      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "apc_1",
          type: "apply_patch_call",
          call_id: "call_patch_1",
          status: "completed",
          operation: {
            type: "update_file",
            path: "notes.txt",
            diff: "@@\n-alpha\n+gamma\n beta"
          }
        } as unknown as ResponseOutputItem
      ];

      const result = await dispatchResponseOutput(outputItems, ctx, state);

      expect(result.sawToolCall).toBe(true);
      expect(result.sawFunctionToolCall).toBe(false);
      expect(fs.readFileSync(targetFile, "utf8")).toBe("gamma\nbeta\n");
      expect(state.runPersistedItems).toContainEqual(expect.objectContaining({
        type: "apply_patch_call",
        call_id: "call_patch_1"
      }));
      const patchOutput = state.runPersistedItems.find(
        (item) => item.type === "apply_patch_call_output" && item.call_id === "call_patch_1"
      ) as { output: string; status: string } | undefined;
      expect(patchOutput).toEqual(expect.objectContaining({ status: "completed" }));
      expect(JSON.parse(patchOutput?.output ?? "")).toEqual({
        result: "Updated notes.txt",
        context: expect.stringContaining("input-token usage")
      });
      expect(appendMessage).toHaveBeenCalledWith(
        ctx.taskId,
        "tool",
        expect.objectContaining({
          tool: "apply_patch",
          callId: "call_patch_1",
          stdout: "Updated notes.txt"
        }),
        expect.anything()
      );
    } finally {
      fs.rmSync(taskRoot, { recursive: true, force: true });
    }
  });

  it("returns failed apply_patch_call_output items when a patch cannot be applied", async () => {
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-fail-"));

    try {
      const ctx = createBaseContext();
      ctx.taskDir = taskRoot;
      ctx.envRoot = taskRoot;
      ctx.workspaceRoot = taskRoot;
      const state: ToolDispatchState = {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      };

      const outputItems: ResponseOutputItem[] = [
        {
          id: "apc_missing",
          type: "apply_patch_call",
          call_id: "call_patch_missing",
          status: "completed",
          operation: {
            type: "update_file",
            path: "missing.txt",
            diff: "@@\n-missing\n+still-missing"
          }
        } as unknown as ResponseOutputItem
      ];

      await dispatchResponseOutput(outputItems, ctx, state);

      expect(state.runPersistedItems).toContainEqual(expect.objectContaining({
        type: "apply_patch_call_output",
        call_id: "call_patch_missing",
        status: "failed",
        output: expect.stringContaining("File not found")
      }));
      expect(appendMessage).toHaveBeenCalledWith(
        ctx.taskId,
        "tool",
        expect.objectContaining({
          tool: "apply_patch",
          callId: "call_patch_missing",
          error: expect.stringContaining("File not found")
        }),
        expect.anything()
      );
    } finally {
      fs.rmSync(taskRoot, { recursive: true, force: true });
    }
  });

  it("pairs a native apply_patch call when its handler throws before producing output", async () => {
    const ctx = createBaseContext();
    let assertCount = 0;
    ctx.assertNotCancelled = async () => {
      assertCount += 1;
      if (assertCount === 3) {
        throw new Error("native patch setup failed");
      }
    };
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    await dispatchResponseOutput([{
      type: "apply_patch_call",
      call_id: "call_patch_unhandled",
      operation: {
        type: "update_file",
        path: "notes.txt",
        diff: "@@\n-old\n+new"
      }
    } as unknown as ResponseOutputItem], ctx, state);

    expect(state.runPersistedItems).toContainEqual(expect.objectContaining({
      type: "apply_patch_call_output",
      call_id: "call_patch_unhandled",
      status: "failed",
      output: expect.stringContaining("native patch setup failed")
    }));
  });
});
