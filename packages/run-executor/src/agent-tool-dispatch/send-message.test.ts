import { expect, it, vi } from "vitest";
import type { ToolDispatchContext, ToolDispatchState } from "./types.js";
import { dispatchResponseOutput } from "./dispatch.js";

it("publishes send_message before a blocking sibling without changing the recorded response order", async () => {
  const state: ToolDispatchState = { conversationItems: [], runPersistedItems: [], commandStep: 0 };
  const output = [
    { type: "function_call" as const, name: "run_shell", call_id: "blocking", arguments: "{}" },
    { type: "function_call" as const, name: "send_message", call_id: "update", arguments: JSON.stringify({ message: "Starting" }) }
  ];
  const publishMidRunMessages = vi.fn(async () => {
    expect(state.conversationItems.slice(0, 2)).toEqual(output);
    expect(state.pendingMidRunMessages).toEqual(["Starting"]);
    state.pendingMidRunMessages = [];
  });
  const ctx = { compatibilityModes: [], assertNotCancelled: async () => {}, publishMidRunMessages,
    features: { handleToolCall: () => null },
    control: { recordToolCallStart: async (call) => {
      if (call.callId === "blocking") {
        expect(publishMidRunMessages).toHaveBeenCalledOnce();
        throw new Error("TASK_CANCELLED");
      }
    }, recordToolCallResult: async () => {} }
  } as unknown as ToolDispatchContext;
  await expect(dispatchResponseOutput(output, ctx, state)).rejects.toThrow("TASK_CANCELLED");
  expect(publishMidRunMessages).toHaveBeenCalledOnce();
  expect(state.conversationItems.slice(0, 2)).toEqual(output);
  expect(state.conversationItems[2]).toMatchObject({ type: "function_call_output", call_id: "update" });
});
