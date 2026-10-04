import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

const mocks = vi.hoisted(() => ({
  listPersistentShellSessions: vi.fn(),
  startPersistentShellSession: vi.fn(),
  stopPersistentShellSession: vi.fn(),
  controlPersistentShellSession: vi.fn(),
  getPersistentShellSessionStatus: vi.fn(),
  startBuiltinToolExecution: vi.fn(),
  finishBuiltinToolSuccess: vi.fn(),
  finishBuiltinToolFailure: vi.fn()
}));

vi.mock("../../runtime/persistent-shell-sessions.js", () => ({
  listPersistentShellSessions: mocks.listPersistentShellSessions,
  startPersistentShellSession: mocks.startPersistentShellSession,
  stopPersistentShellSession: mocks.stopPersistentShellSession,
  controlPersistentShellSession: mocks.controlPersistentShellSession,
  getPersistentShellSessionStatus: mocks.getPersistentShellSessionStatus,
  buildPersistentShellEnvironment: vi.fn()
}));

vi.mock("../events.js", () => ({
  startBuiltinToolExecution: mocks.startBuiltinToolExecution,
  finishBuiltinToolSuccess: mocks.finishBuiltinToolSuccess,
  finishBuiltinToolFailure: mocks.finishBuiltinToolFailure
}));

import { handleShellSession } from "./persistent-shell.js";

function createMockContext(overrides?: Partial<ToolDispatchContext>): ToolDispatchContext {
  return {
    taskId: "task-1",
    workspaceId: "ws-1",
    environmentId: "env-1",
    actorUserId: "user-1",
    taskDir: "/task",
    envRoot: "/env",
    workspaceRoot: "/workspace",
    persistentRuntimeEnabled: true,
    shellNetworkEnabled: false,
    workspaceRunAsRoot: false,
    shellEnvOverrides: {},
    assertNotCancelled: vi.fn(),
    getCurrentLeafMessageId: vi.fn(),
    setCurrentLeafMessageId: vi.fn(),
    ...overrides
  } as unknown as ToolDispatchContext;
}

function createMockState(): ToolDispatchState {
  return {
    conversationItems: [],
    runPersistedItems: [],
    commandStep: 0
  } as unknown as ToolDispatchState;
}

describe("handleShellSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startBuiltinToolExecution.mockResolvedValue({
      toolName: "shell_session",
      callId: "call-1",
      step: 0,
      inputLabel: "Persistent shell session",
      inputText: "list"
    });
  });

  it("lists persistent shell sessions for the project", async () => {
    mocks.listPersistentShellSessions.mockResolvedValueOnce([
      {
        id: "session-1",
        status: "idle",
        command: "python3",
        workingDir: "/env/sub",
        startedAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:01:00.000Z",
        mode: "terminal",
        commandId: "cmd-1",
        exitCode: 0,
        outputTruncated: false,
        lifetimeSeconds: 43200,
        expiresAt: "2026-09-08T12:00:00.000Z"
      }
    ]);

    const call: ResponseFunctionToolCall = {
      id: "call-1",
      type: "function_call",
      name: "shell_session",
      call_id: "call-1",
      arguments: JSON.stringify({
        action: "list",
        session_id: null,
        command: null,
        lifetime_seconds: null,
        tail_lines: null,
        save_output_path: null,
        mode: null,
        data: null,
        cols: null,
        rows: null
      })
    };

    const ctx = createMockContext();
    const state = createMockState();

    await handleShellSession(call, ctx, state);

    expect(mocks.listPersistentShellSessions).toHaveBeenCalledWith({ environmentId: "env-1" });
    expect(mocks.finishBuiltinToolSuccess).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      {
        sessions: [
          {
            session_id: "session-1",
            status: "idle",
            command: "python3",
            cwd: "/env/sub",
            mode: "terminal",
            started_at: "2026-09-08T00:00:00.000Z",
            updated_at: "2026-09-08T00:01:00.000Z",
            command_id: "cmd-1",
            exit_code: 0,
            output_truncated: false,
            lifetime_seconds: 43200,
            expires_at: "2026-09-08T12:00:00.000Z"
          }
        ]
      }
    );
  });

  it("starts a persistent shell session with specified lifetime", async () => {
    mocks.startPersistentShellSession.mockResolvedValueOnce({
      sessionId: "session-2",
      lifetimeSeconds: 86400,
      expiresAt: "2026-09-09T00:00:00.000Z",
      limits: { memoryMb: 640, cpus: 1, pids: 400 }
    });

    const call: ResponseFunctionToolCall = {
      id: "call-start",
      type: "function_call",
      name: "shell_session",
      call_id: "call-start",
      arguments: JSON.stringify({
        action: "start",
        session_id: null,
        command: "node server.js",
        lifetime_seconds: 86400,
        tail_lines: null,
        save_output_path: null,
        mode: "terminal",
        data: null,
        cols: null,
        rows: null
      })
    };

    const ctx = createMockContext();
    const state = createMockState();

    await handleShellSession(call, ctx, state);

    expect(mocks.startPersistentShellSession).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node server.js",
        mode: "terminal",
        lifetimeSeconds: 86400
      })
    );
    expect(mocks.finishBuiltinToolSuccess).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      {
        session_id: "session-2",
        status: "running",
        lifetime_seconds: 86400,
        expires_at: "2026-09-09T00:00:00.000Z",
        sandbox_limits: { memory_mb: 640, cpus: 1, pids: 400 }
      }
    );
  });

  it("fails when persistent runtime is disabled", async () => {
    const call: ResponseFunctionToolCall = {
      id: "call-2",
      type: "function_call",
      name: "shell_session",
      call_id: "call-2",
      arguments: JSON.stringify({
        action: "list",
        session_id: null,
        command: null,
        lifetime_seconds: null,
        tail_lines: null,
        save_output_path: null,
        mode: null,
        data: null,
        cols: null,
        rows: null
      })
    };

    const ctx = createMockContext({ persistentRuntimeEnabled: false });
    const state = createMockState();

    await handleShellSession(call, ctx, state);

    expect(mocks.finishBuiltinToolFailure).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      "Persistent project shell sessions are disabled for this project."
    );
  });
});
