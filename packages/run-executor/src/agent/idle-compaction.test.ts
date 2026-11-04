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

  it("leaves the context window untouched when the turn fails", async () => {
    const execution = {
      maxRunSteps: 100,
      prepared: { control: { context: {} } },
      state: { contextManagement: { version: "v2" }, dispatchState: { conversationItems: [], runPersistedItems: [] } }
    } as never;

    await expect(runIdleCompaction(execution, async () => {
      throw new Error("502 Rate limit reached");
    })).rejects.toThrow("Rate limit reached");

    expect(mocks.recordContextItems).not.toHaveBeenCalled();
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
