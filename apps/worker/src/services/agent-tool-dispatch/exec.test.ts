import { describe, expect, it, vi } from "vitest";
import type { ResponseOutputItem } from "openai/resources/responses/responses";
import { dispatchResponseOutput, type ToolDispatchContext, type ToolDispatchState } from "./index.js";
import { appendMessage } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { executeShellCommand } from "../runtime/shell.js";
import { buildRunShellFunctionTool } from "../agent-tools/index.js";

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn(async () => "msg-1"),
  consumeCommandInterruptForStep: vi.fn(async () => false),
  isCancellationRequested: async () => false
}));
vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn(async () => {})
}));
vi.mock("../runtime/shell.js", () => ({
  executeShellCommand: vi.fn(async (input: { command: string }) => ({
    command: input.command,
    stdout: input.command === "ls" ? "notes.txt\n" : `ran ${input.command}\n`,
    stderr: "",
    exitCode: 0,
    timedOut: false,
    aborted: false,
    cwd: "/tmp/task",
    stateReset: false
  }))
}));

function createContext(): ToolDispatchContext {
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
    skillsRootDir: null,
    isSkillAdmin: false,
    isThreadTask: false,
    activeMcpConnections: new Map(),
    activeSkillTools: [],
    codeModeTools: [buildRunShellFunctionTool()],
    enableSkillById: async () => ({ doc: null, toolNames: [] }),
    getCurrentLeafMessageId: () => null,
    setCurrentLeafMessageId: () => {},
    assertNotCancelled: async () => {}
  };
}

function execCall(code: string, summary: string | null | undefined = null): ResponseOutputItem[] {
  return [{
    id: "fc_exec",
    type: "function_call",
    name: "exec",
    call_id: "call_exec",
    arguments: JSON.stringify({ code, timeout_seconds: null, summary }),
    status: "completed"
  }];
}

function execOutput(state: ToolDispatchState): Record<string, unknown> {
  const item = state.conversationItems.find((entry) => entry.type === "function_call_output" && entry.call_id === "call_exec");
  return JSON.parse((item as { output: string }).output) as Record<string, unknown>;
}

describe("exec", () => {
  it("runs tools through their handlers and gives the model only the script's output", async () => {
    vi.clearAllMocks();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput(execCall(`
      const listing = await tools.run_shell({ command: "ls" });
      const file = listing.stdout.trim();
      const shown = await tools.run_shell({ command: "cat " + file });
      console.log(shown.stdout.trim());
    `), createContext(), state);

    expect(vi.mocked(executeShellCommand).mock.calls.map(([input]) => input.command)).toEqual(["ls", "cat notes.txt"]);
    expect(state.conversationItems.map((item) => (item as { call_id?: string }).call_id)).toEqual(["call_exec", "call_exec"]);
    expect(state.runPersistedItems).toHaveLength(2);
    expect(execOutput(state)).toMatchObject({ logs: "ran cat notes.txt", tool_calls: 2 });
    expect(state.commandStep).toBe(3);
  });

  it("marks the shown tool messages of nested calls so they are never replayed as model calls", async () => {
    vi.clearAllMocks();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput(execCall(`await tools.run_shell({ command: "ls" });`), createContext(), state);

    const contents = vi.mocked(appendMessage).mock.calls.map(([, , content]) => content as Record<string, unknown>);
    expect(contents.find((content) => content.tool === "run_shell")).toMatchObject({ code_mode_parent_call_id: "call_exec" });
    expect(contents.find((content) => content.tool === "exec")).not.toHaveProperty("code_mode_parent_call_id");
  });

  it("only exposes the tools offered through exec this turn", async () => {
    vi.clearAllMocks();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    const result = await dispatchResponseOutput(execCall(`
      console.log(Object.keys(tools).join(","));
      await tools.final_response({ response: "done", notify: false, partial: false });
    `), createContext(), state);

    expect(result.finalResponse).toBeNull();
    expect(execOutput(state)).toMatchObject({ logs: "run_shell", error: expect.stringContaining("TypeError") });
  });

  it("shows the step summary on the live call and the stored activity as one line", async () => {
    vi.clearAllMocks();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput(execCall(`await tools.run_shell({ command: "ls" });`, "  Listing the\n project files "), createContext(), state);

    const execStart = vi.mocked(emitTaskEvent).mock.calls.find(([, type, payload]) => type === "command_start" && payload.tool === "exec");
    expect(execStart?.[2]).toMatchObject({ summary: "Listing the project files" });
    const contents = vi.mocked(appendMessage).mock.calls.map(([, , content]) => content as Record<string, unknown>);
    expect(contents.find((content) => content.tool === "exec")).toMatchObject({ summary: "Listing the project files" });
    expect(contents.find((content) => content.tool === "run_shell")).not.toHaveProperty("summary");
  });

  it("runs without a summary when the model leaves the key out", async () => {
    vi.clearAllMocks();
    const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };

    await dispatchResponseOutput(execCall(`await tools.run_shell({ command: "ls" });`, undefined), createContext(), state);

    expect(execOutput(state)).not.toHaveProperty("error");

    const contents = vi.mocked(appendMessage).mock.calls.map(([, , content]) => content as Record<string, unknown>);
    expect(contents.find((content) => content.tool === "exec")).not.toHaveProperty("summary");
  });
});
