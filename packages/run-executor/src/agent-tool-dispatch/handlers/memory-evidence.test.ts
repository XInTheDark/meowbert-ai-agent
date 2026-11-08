import { describe, expect, it, vi } from "vitest";
import { handleReadTaskEvidence } from "./memory-evidence.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

const args = { task_id: "10000000-0000-4000-8000-000000000001", message_id: null, before_message_id: null, offset_chars: null };
const call = { type: "function_call" as const, name: "read_task_evidence", call_id: "evidence", arguments: JSON.stringify(args) };
function fixture(memoryEnabled = true, allowTaskHistoryTools = true) {
  const readTaskEvidence = vi.fn(async () => ({ task_id: args.task_id, items: [{ message_id: "source", role: "tool", content: "passed" }], next_before_message_id: null }));
  const ctx = { memoryEnabled, allowTaskHistoryTools, assertNotCancelled: vi.fn(),
    control: { platform: { readTaskEvidence }, emitEvent: vi.fn(), appendMessage: vi.fn(async () => "message"), selectBranch: vi.fn() },
    getCurrentLeafMessageId: () => null, setCurrentLeafMessageId: vi.fn() } as unknown as ToolDispatchContext;
  const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
  return { ctx, state, readTaskEvidence };
}

describe("read_task_evidence dispatch", () => {
  it("returns and records the original evidence with the requested source identity", async () => {
    const { ctx, state, readTaskEvidence } = fixture();
    const result = await handleReadTaskEvidence(call, ctx, state);
    expect(readTaskEvidence).toHaveBeenCalledExactlyOnceWith(args);
    expect(result.output).toMatchObject({ task_id: args.task_id, items: [{ message_id: "source", content: "passed" }] });
    expect(ctx.control.appendMessage).toHaveBeenCalledOnce();
  });

  it.each([[false, true], [true, false]])("rejects unavailable evidence before reaching the control plane (%s, %s)", async (memory, history) => {
    const { ctx, state, readTaskEvidence } = fixture(memory, history);
    expect((await handleReadTaskEvidence(call, ctx, state)).output).toMatchObject({ error: expect.stringContaining("disabled") });
    expect(readTaskEvidence).not.toHaveBeenCalled();
  });
});
