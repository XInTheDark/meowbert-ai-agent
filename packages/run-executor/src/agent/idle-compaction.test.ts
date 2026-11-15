import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resetV2ContextWindow: vi.fn(), recordContextItems: vi.fn() }));
vi.mock("./context-window.js", () => ({ resetV2ContextWindow: mocks.resetV2ContextWindow }));
vi.mock("../context-management-v2/window.js", () => ({ recordContextItems: mocks.recordContextItems }));

import { assertIdleCompactionNotExpired, runIdleCompaction } from "./idle-compaction.js";

describe("runIdleCompaction", () => {
  beforeEach(() => {
    mocks.resetV2ContextWindow.mockClear();
    mocks.recordContextItems.mockClear();
  });

  it("keeps the last exchange with the user, not the idle turn's own text", async () => {
    const conversationItems: unknown[] = [
      { role: "user", content: "which option?" },
      { type: "function_call", call_id: "call-1", name: "final_response", arguments: JSON.stringify({ response: "options A and B" }) }
    ];
    const execution = {
      maxRunSteps: 100,
      prepared: { control: { context: {} } },
      state: { contextManagement: { version: "v2" }, dispatchState: { conversationItems, runPersistedItems: [] } }
    } as never;

    await runIdleCompaction(execution, async () => {
      conversationItems.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Notes updated." }] });
    });

    expect(mocks.resetV2ContextWindow).toHaveBeenCalledWith(execution, "idle", [
      { role: "user", content: "which option?" },
      { role: "assistant", content: "options A and B" }
    ]);
  });

  it("still rolls the window over when the notes turn hits a model error", async () => {
    const conversationItems: unknown[] = [{ role: "user", content: "which option?" }];
    const runPersistedItems: unknown[] = [];
    const execution = {
      maxRunSteps: 100,
      prepared: { control: { context: {} }, cancellationMonitor: { signal: new AbortController().signal } },
      state: { contextManagement: { version: "v2" }, dispatchState: { conversationItems, runPersistedItems } }
    } as never;

    const result = await runIdleCompaction(execution, async () => {
      throw new Error("502 Rate limit reached");
    });

    expect(result).toEqual({ notesTurn: "failed", errorMessage: "502 Rate limit reached" });
    expect(mocks.recordContextItems).not.toHaveBeenCalled();
    expect(mocks.resetV2ContextWindow).toHaveBeenCalledWith(execution, "idle", [{ role: "user", content: "which option?" }]);
    expect(runPersistedItems).toEqual([]);
  });

  it("does not roll the window over when the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const execution = {
      maxRunSteps: 100,
      prepared: { control: { context: {} }, cancellationMonitor: { signal: controller.signal } },
      state: { contextManagement: { version: "v2" }, dispatchState: { conversationItems: [], runPersistedItems: [] } }
    } as never;

    await expect(runIdleCompaction(execution, async () => {
      throw new Error("TASK_CANCELLED");
    })).rejects.toThrow("TASK_CANCELLED");

    expect(mocks.resetV2ContextWindow).not.toHaveBeenCalled();
  });
});

describe("assertIdleCompactionNotExpired", () => {
  it("rejects a run that started after its deadline", () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(() => assertIdleCompactionNotExpired({ idleCompactionDeadlineAt: past })).toThrow();
    expect(() => assertIdleCompactionNotExpired({ idleCompactionDeadlineAt: future })).not.toThrow();
    expect(() => assertIdleCompactionNotExpired({})).not.toThrow();
  });
});
