import { describe, expect, it, vi } from "vitest";
import type { ContextManagementV2State } from "../../context-management-v2/types.js";
import { NOTES_WRITE_FILE_TOOL_NAME } from "../../agent-tools/index.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

const mocks = vi.hoisted(() => ({
  recordContextItems: vi.fn(),
  writeNote: vi.fn()
}));

vi.mock("../../context-management-v2/window.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../context-management-v2/window.js")>(),
  recordContextItems: mocks.recordContextItems
}));

import { dispatchResponseOutput } from "../dispatch.js";

const contextManagementV2: ContextManagementV2State = {
  version: "v2",
  taskId: "task-1",
  firstWindowId: "window-1",
  windowId: "window-1",
  contextNodeId: "node-1",
  previousWindowId: null,
  branchLeafMessageId: null,
  reminderSent: false,
  pendingReset: false,
  recoveryPhase: "normal"
};

describe("Context Management V2 tool calls", () => {
  it("persists the context tool output for the task conversation", async () => {
    mocks.writeNote.mockResolvedValue({ path: "notes/continuity.md", updated: true });
    const call = {
      type: "function_call",
      call_id: "call-1",
      name: NOTES_WRITE_FILE_TOOL_NAME,
      arguments: JSON.stringify({ path: "notes/continuity.md", text: "Continue from the test." })
    } as never;
    const state = {
      conversationItems: [],
      runPersistedItems: [],
      contextUsage: { usedTokens: 64_000, maxContextTokens: 256_000, percent: 25 },
      commandStep: 0
    } as ToolDispatchState;
    const control = { context: { writeNote: mocks.writeNote }, recordToolCallStart: async () => {}, recordToolCallResult: async () => {} };
    const ctx = { control, contextManagementV2, compatibilityModes: [], assertNotCancelled: async () => {} } as unknown as ToolDispatchContext;

    await dispatchResponseOutput([call], ctx, state);

    const output = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(output).toMatchObject({ call_id: "call-1" });
    expect(mocks.recordContextItems).toHaveBeenLastCalledWith(control.context, contextManagementV2, [output]);
    expect(JSON.parse((output as { output: string }).output)).toEqual({
      updated: true,
      context: "Model request that produced this tool call: 64000 / 256000 tokens (25%)."
    });
  });
});
