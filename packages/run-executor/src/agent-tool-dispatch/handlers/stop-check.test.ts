import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { EMPTY_HARNESS_SETTINGS } from "@meowbert/shared";

vi.mock("../../runtime/shell.js", () => ({ executeShellCommand: vi.fn() }));

import { executeShellCommand } from "../../runtime/shell.js";
import { createHarnessRunState } from "../../agent/harness-run-state.js";
import type { ToolDispatchContext } from "../types.js";
import { runStopCheck } from "./stop-check.js";

const mockedExec = vi.mocked(executeShellCommand);

function call(args: Record<string, unknown> = { response: "done" }): ResponseFunctionToolCall {
  return { type: "function_call", call_id: "call-1", name: "final_response", arguments: JSON.stringify(args) };
}

function context(options: { readOnly?: boolean } = {}): ToolDispatchContext {
  const harness = createHarnessRunState({
    settings: { ...EMPTY_HARNESS_SETTINGS, stopCheck: { value: { command: "npm test", timeoutSeconds: 60 }, setBy: "user" } },
    spentTokens: 0,
    maxStopCheckAttempts: 2,
    agentMayChange: true
  });
  return {
    harness,
    readOnly: options.readOnly === true,
    settings: { shell: "bash", maxCommandOutputKb: 64 },
    control: { emitEvent: vi.fn(async () => undefined) },
    assertNotCancelled: vi.fn(async () => undefined)
  } as unknown as ToolDispatchContext;
}

function shellResult(exitCode: number) {
  return { exitCode, timedOut: false, stdout: "1 failing", stderr: "" } as Awaited<ReturnType<typeof executeShellCommand>>;
}

describe("runStopCheck", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts the answer when the check passes", async () => {
    mockedExec.mockResolvedValueOnce(shellResult(0));
    await expect(runStopCheck(call(), context())).resolves.toEqual({ kind: "passed" });
  });

  it("rejects the answer with the check's output while it fails, then lets it through after the attempt limit", async () => {
    const ctx = context();
    mockedExec.mockResolvedValue(shellResult(1));

    const first = await runStopCheck(call(), ctx);
    expect(first.kind).toBe("rejected");
    expect(first.kind === "rejected" && JSON.stringify(first.result)).toContain("1 failing");
    expect((await runStopCheck(call(), ctx)).kind).toBe("rejected");

    expect((await runStopCheck(call(), ctx)).kind).toBe("bypassed");
    expect(mockedExec).toHaveBeenCalledTimes(2);
  });

  it("skips the check for partial answers and read-only tasks", async () => {
    await expect(runStopCheck(call({ response: "progress", partial: true }), context())).resolves.toEqual({ kind: "none" });
    await expect(runStopCheck(call(), context({ readOnly: true }))).resolves.toEqual({ kind: "none" });
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
