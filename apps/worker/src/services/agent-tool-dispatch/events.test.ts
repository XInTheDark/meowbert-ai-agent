import { describe, expect, it, vi } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { appendMessage, setTaskBranchSelection } from "../agent-db/index.js";
import { appendBuiltinToolMessage, finishBuiltinToolSuccess, type BuiltinToolExecution } from "./events.js";
import { recordFunctionCallResult } from "./state.js";
import type { ToolDispatchState } from "./types.js";
import type { ToolDispatchContext } from "./types.js";

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn(),
  setTaskBranchSelection: vi.fn()
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn()
}));

function createExecution(): BuiltinToolExecution {
  return {
    outputItem: {
      type: "function_call",
      call_id: "call-1",
      name: "run_shell",
      arguments: "{}"
    } as ResponseFunctionToolCall,
    toolName: "run_shell",
    callId: "call-1",
    step: 1,
    inputLabel: "Command",
    inputText: "pwd",
    command: "pwd",
    startedAtMs: 0,
    interruptible: true
  };
}

describe("appendBuiltinToolMessage", () => {
  it("moves the selected branch to each persisted tool message", async () => {
    vi.mocked(appendMessage).mockResolvedValueOnce("tool-message-1");
    const setCurrentLeafMessageId = vi.fn();
    const context = {
      taskId: "task-1",
      selectionUserId: "user-1",
      getCurrentLeafMessageId: () => "previous-leaf",
      setCurrentLeafMessageId
    } as ToolDispatchContext;

    await appendBuiltinToolMessage(context, createExecution(), { stdout: "ok" });

    expect(setCurrentLeafMessageId).toHaveBeenCalledWith("tool-message-1");
    expect(setTaskBranchSelection).toHaveBeenCalledWith("task-1", "user-1", "tool-message-1");
  });

  it("keeps command metadata while omitting the command from the model output", async () => {
    vi.mocked(appendMessage).mockResolvedValueOnce("tool-message-2");
    const context = {
      taskId: "task-1",
      getCurrentLeafMessageId: () => null,
      setCurrentLeafMessageId: () => {}
    } as ToolDispatchContext;
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };

    const result = await finishBuiltinToolSuccess(context, createExecution(), {
      command: "pwd",
      stdout: "/tmp\n"
    }, {
      messagePayload: { stdout: "/tmp\n" }
    });
    recordFunctionCallResult(state, "call-1", "run_shell", result);

    const requestOutput = JSON.parse((state.conversationItems[0] as { output: string }).output) as Record<string, unknown>;
    expect(requestOutput.command).toBeUndefined();
    expect(requestOutput.stdout).toBe("/tmp\n");

    const messagePayload = vi.mocked(appendMessage).mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(messagePayload.command).toBe("pwd");
    expect(messagePayload.stdout).toBe("/tmp\n");
    const responseOutput = messagePayload.response_function_output as { output: string };
    expect(JSON.parse(responseOutput.output)).not.toHaveProperty("command");
  });
});
