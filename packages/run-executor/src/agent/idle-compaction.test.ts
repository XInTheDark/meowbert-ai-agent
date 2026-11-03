import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resetV2ContextWindow: vi.fn() }));
vi.mock("./context-window.js", () => ({ resetV2ContextWindow: mocks.resetV2ContextWindow }));
vi.mock("../context-management-v2/window.js", () => ({ recordContextItems: vi.fn() }));

import { runIdleCompaction } from "./idle-compaction.js";

describe("runIdleCompaction", () => {
  beforeEach(() => mocks.resetV2ContextWindow.mockClear());

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
});
