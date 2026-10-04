import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

vi.mock("../../runtime/wait.js", () => ({ waitForConditions: vi.fn() }));
vi.mock("../../task-schedules/service.js", () => ({ applyInfiniteWait: vi.fn() }));
vi.mock("../events.js", () => ({
  startBuiltinToolExecution: vi.fn(async () => ({ toolName: "wait" })),
  finishBuiltinToolSuccess: vi.fn(async (_ctx: unknown, _execution: unknown, output: unknown) => ({ output })),
  finishBuiltinToolFailure: vi.fn(async (_ctx: unknown, _execution: unknown, error: string) => ({ output: { error } }))
}));

import { waitForConditions } from "../../runtime/wait.js";
import { applyInfiniteWait } from "../../task-schedules/service.js";
import { finishBuiltinToolSuccess, finishBuiltinToolFailure } from "../events.js";
import { handleWaitTool } from "./wait.js";

const condition = { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", on_output: true, on_exit: true };
const state = { conversationItems: [], runPersistedItems: [], commandStep: 0 } as ToolDispatchState;

function context(overrides: Partial<ToolDispatchContext> = {}): ToolDispatchContext {
  return {
    taskId: "task-1", environmentId: "project-1", taskDir: "/task", runMode: "default",
    persistentRuntimeEnabled: true, actorUserId: "user-1", assertNotCancelled: vi.fn(async () => {}),
    ...overrides
  } as ToolDispatchContext;
}

function call(args: Record<string, unknown>): ResponseFunctionToolCall {
  return { id: "call-1", type: "function_call", call_id: "call-1", name: "wait", arguments: JSON.stringify(args) };
}

describe("handleWaitTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(waitForConditions).mockReset().mockResolvedValue({ reason: "timeout", elapsed_seconds: 2, session: null });
    vi.mocked(applyInfiniteWait).mockResolvedValue("2026-09-11T00:00:00.000Z");
  });

  it("returns a normal tool result, not a terminal wait request, for a normal run", async () => {
    const ctx = context({ persistentRuntimeEnabled: false });
    const result = await handleWaitTool(call({ seconds: 2, shell_sessions: null, response: null, notify: null }), ctx, state);
    expect(result).toEqual({ output: { reason: "timeout", elapsed_seconds: 2, session: null } });
    expect(waitForConditions).toHaveBeenCalledWith(expect.objectContaining({ seconds: 2, shellSessions: [] }));
    expect(applyInfiniteWait).not.toHaveBeenCalled();
  });

  it.each(["default", "infinite_auto", "agent_swarm_worker"] as const)("waits within a %s run when shell conditions are supplied", async (runMode) => {
    const ctx = context({ runMode });
    expect((await handleWaitTool(call({ seconds: 10, shell_sessions: [condition] }), ctx, state)).waitRequest).toBeUndefined();
    expect(waitForConditions).toHaveBeenCalledWith(expect.objectContaining({
      seconds: 10, shellSessions: [condition], environmentId: "project-1", taskDir: "/task"
    }));
    expect(applyInfiniteWait).not.toHaveBeenCalled();
  });

  it("requires shell conditions for Agent Swarm waits", async () => {
    const ctx = context({
      runMode: "agent_swarm_worker",
      workflowContext: { workflowType: "agent_swarm" } as ToolDispatchContext["workflowContext"]
    });
    await handleWaitTool(call({ seconds: 10, shell_sessions: null }), ctx, state);
    expect(finishBuiltinToolFailure).toHaveBeenCalledWith(ctx, expect.anything(), expect.stringContaining("require a shell session condition"));
    expect(waitForConditions).not.toHaveBeenCalled();

    await handleWaitTool(call({ seconds: 10, shell_sessions: [condition] }), ctx, state);
    expect(waitForConditions).toHaveBeenCalledWith(expect.objectContaining({ shellSessions: [condition] }));
  });

  it("preserves saved infinite recurring time-only calls and notification behavior", async () => {
    const ctx = context({ runMode: "infinite_auto" });
    expect((await handleWaitTool(call({ seconds: 604800, response: " Next week ", notify: false }), ctx, state)).waitRequest).toEqual({
      seconds: 604800, response: "Next week", notify: false, nextRunAt: "2026-09-11T00:00:00.000Z"
    });
    expect(applyInfiniteWait).toHaveBeenCalledWith("task-1", 604800);
    expect(waitForConditions).not.toHaveBeenCalled();
  });

  it.each([{ seconds: 10, response: "update" }, { seconds: 60, response: null }])("rejects invalid recurring scheduling parameters %j", async (args) => {
    await handleWaitTool(call(args), context({ runMode: "infinite_auto" }), state);
    expect(finishBuiltinToolFailure).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining("Infinite recurring time-only waits require"));
    expect(applyInfiniteWait).not.toHaveBeenCalled();
  });

  it.each([{ persistentRuntimeEnabled: false }, { actorUserId: null }])("rejects unavailable shell access %j", async (overrides) => {
    await handleWaitTool(call({ seconds: 10, shell_sessions: [condition] }), context(overrides), state);
    expect(finishBuiltinToolFailure).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining("requires persistent project shells"));
    expect(waitForConditions).not.toHaveBeenCalled();
  });

  it("returns runtime errors as tool failures", async () => {
    vi.mocked(waitForConditions).mockRejectedValue(new Error("In-run wait seconds must be between 1 and 3600."));
    await handleWaitTool(call({ seconds: 3601 }), context(), state);
    expect(finishBuiltinToolFailure).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining("between 1 and 3600"));
  });

  it.each(["TASK_CANCELLED", "RUN_TIME_LIMIT_REACHED"])("propagates %s to the agent loop", async (message) => {
    vi.mocked(waitForConditions).mockRejectedValue(new Error(message));
    await expect(handleWaitTool(call({ seconds: 10 }), context(), state)).rejects.toThrow(message);
    expect(finishBuiltinToolFailure).not.toHaveBeenCalled();
  });

  it("rejects malformed conditions before waiting or scheduling", async () => {
    const result = await handleWaitTool(call({ seconds: 10, shell_sessions: [{ ...condition, on_output: false, on_exit: false }] }), context(), state);
    expect(result).toEqual({ output: { error: expect.any(String) } });
    expect(waitForConditions).not.toHaveBeenCalled();
    expect(applyInfiniteWait).not.toHaveBeenCalled();
  });
});
