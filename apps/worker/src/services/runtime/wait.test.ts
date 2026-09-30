import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./persistent-shell-sessions.js", () => ({ getPersistentShellSessionStatus: vi.fn() }));

import { getPersistentShellSessionStatus, type PersistentShellSessionStatusResult } from "./persistent-shell-sessions.js";
import { waitForConditions } from "./wait.js";

const getStatus = vi.mocked(getPersistentShellSessionStatus);
const first = { session_id: "session-1", on_output: true, on_exit: true };
const second = { ...first, session_id: "session-2" };

function status(overrides: Partial<PersistentShellSessionStatusResult> = {}): PersistentShellSessionStatusResult {
  return {
    sessionId: "session-1", status: "running", command: "build", startedAt: null,
    completedAt: null, stoppedAt: null, stopReason: null, output: "working", outputFile: null,
    outputVersion: "v1", mode: "terminal", commandId: "command-1", exitCode: null,
    cwd: "/project", outputTruncated: false, lifetimeSeconds: 43200, expiresAt: null,
    ...overrides
  };
}

function input(overrides: Partial<Parameters<typeof waitForConditions>[0]> = {}) {
  return {
    seconds: 10, shellSessions: [first], environmentId: "project-1", taskDir: "/task",
    assertNotCancelled: vi.fn(async () => {}), ...overrides
  };
}

describe("waitForConditions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getStatus.mockReset().mockResolvedValue(status());
  });
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("waits only for the fixed maximum when no shell conditions are supplied", async () => {
    const pending = waitForConditions(input({ seconds: 2, shellSessions: [] }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ reason: "timeout", session: null, elapsed_seconds: 2 });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("times out when none of the selected shell conditions change", async () => {
    const pending = waitForConditions(input({ seconds: 2 }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ reason: "timeout", elapsed_seconds: 2 });
    expect(getStatus).toHaveBeenCalledWith({ sessionId: "session-1", environmentId: "project-1", taskDir: "/task" });
  });

  it("wakes for raw new output even when the displayed tail is unchanged and exit is null", async () => {
    getStatus.mockResolvedValueOnce(status()).mockResolvedValue(status({ outputVersion: "v2", outputTruncated: true }));
    const pending = waitForConditions(input());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({
      reason: "shell_output", elapsed_seconds: 1,
      session: { session_id: "session-1", output: "working", exit_code: null, output_truncated: true }
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("ignores existing output and exit codes when only new output is selected", async () => {
    getStatus.mockResolvedValue(status({ status: "idle", exitCode: 0 }));
    const pending = waitForConditions(input({ seconds: 2, shellSessions: [{ ...first, on_exit: false }] }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ reason: "timeout" });
  });

  it.each([0, 2])("wakes immediately for an already-present exit code %s", async (exitCode) => {
    getStatus.mockResolvedValue(status({ status: "idle", exitCode }));
    expect(await waitForConditions(input())).toMatchObject({
      reason: "shell_exit", elapsed_seconds: 0, session: { exit_code: exitCode, status: "idle" }
    });
  });

  it("ignores output-only changes when only exit is selected, then wakes on completion", async () => {
    getStatus.mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ outputVersion: "v2" }))
      .mockResolvedValue(status({ outputVersion: "v2", status: "idle", exitCode: 0 }));
    const pending = waitForConditions(input({ shellSessions: [{ ...first, on_output: false }] }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ reason: "shell_exit", elapsed_seconds: 2 });
  });

  it("wakes on any session without waiting for a slower status read", async () => {
    let resolveSlow!: (value: PersistentShellSessionStatusResult) => void;
    getStatus.mockImplementation(async ({ sessionId }) => sessionId === "session-1"
      ? new Promise((resolve) => { resolveSlow = resolve; })
      : status({ sessionId, exitCode: 1, status: "idle" }));
    const result = await waitForConditions(input({ shellSessions: [first, second] }));
    expect(result).toMatchObject({ reason: "shell_exit", session: { session_id: "session-2", exit_code: 1 } });
    resolveSlow(status());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps the maximum bounded even while a status read is pending", async () => {
    let resolveSlow!: (value: PersistentShellSessionStatusResult) => void;
    getStatus.mockImplementation(() => new Promise((resolve) => { resolveSlow = resolve; }));
    const pending = waitForConditions(input({ seconds: 1 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ reason: "timeout", elapsed_seconds: 1 });
    resolveSlow(status());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it.each(["TASK_CANCELLED", "RUN_TIME_LIMIT_REACHED"])("interrupts promptly for %s", async (message) => {
    const controller = new AbortController();
    const pending = waitForConditions(input({ shellSessions: [], signal: controller.signal }));
    const assertion = expect(pending).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error(message));
    await assertion;
  });

  it("checks cancellation even when no abort signal was supplied", async () => {
    const assertNotCancelled = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("TASK_CANCELLED"));
    const pending = waitForConditions(input({ shellSessions: [], assertNotCancelled }));
    const assertion = expect(pending).rejects.toThrow("TASK_CANCELLED");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("surfaces missing or foreign sessions without continuing to poll", async () => {
    getStatus.mockRejectedValue(new Error("Persistent shell session not found: session-1"));
    await expect(waitForConditions(input())).rejects.toThrow("not found");
  });

  it.each(["stopped", "failed", "completed"] as const)("surfaces a %s session with no matching exit or output", async (sessionStatus) => {
    getStatus.mockResolvedValue(status({ status: sessionStatus }));
    await expect(waitForConditions(input())).rejects.toThrow(`is ${sessionStatus}`);
  });

  it.each([0, 3601, Infinity, NaN, 1.5])("rejects an invalid or unbounded timeout %s", async (seconds) => {
    await expect(waitForConditions(input({ seconds }))).rejects.toThrow("between 1 and 3600");
    expect(getStatus).not.toHaveBeenCalled();
  });
});
