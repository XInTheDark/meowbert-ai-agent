import { describe, expect, it, vi } from "vitest";
import type { ResponseOutputItem } from "openai/resources/responses/responses";
import type { ContextManagementV2State } from "../context-management-v2/types.js";
import type { ToolDispatchContext, ToolDispatchState } from "./types.js";

const mocks = vi.hoisted(() => ({
  handleApplyPatch: vi.fn(),
  recordContextItems: vi.fn(async () => {})
}));

vi.mock("../context-management-v2/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../context-management-v2/index.js")>();
  return {
    ...actual,
    recordContextItems: mocks.recordContextItems
  };
});

vi.mock("./handlers/apply-patch.js", () => ({
  handleApplyPatch: mocks.handleApplyPatch
}));

import { dispatchResponseOutput } from "./dispatch.js";

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

describe("dispatchResponseOutput Context Management V2 persistence", () => {
  it("records the output added by apply_patch after a custom tool call", async () => {
    mocks.recordContextItems.mockClear();
    mocks.handleApplyPatch.mockImplementationOnce(async (outputItem, _ctx, state) => {
      const output = {
        type: "custom_tool_call_output",
        call_id: outputItem.call_id,
        output: "done"
      };
      state.conversationItems.push(output);
      state.runPersistedItems.push(output);
    });
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };
    const ctx = {
      contextManagementV2,
      compatibilityModes: [],
      assertNotCancelled: async () => {}
    } as ToolDispatchContext;

    await dispatchResponseOutput([{
      type: "custom_tool_call",
      name: "apply_patch",
      call_id: "ctc_v2_apply_patch_1",
      input: "*** Begin Patch\n*** End Patch"
    } as unknown as ResponseOutputItem], ctx, state);

    expect(mocks.recordContextItems).toHaveBeenCalledTimes(2);
    expect(mocks.recordContextItems.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({
        type: "custom_tool_call_output",
        call_id: "ctc_v2_apply_patch_1"
      })
    ]);
  });

  it("records the output added after a custom tool call", async () => {
    mocks.recordContextItems.mockClear();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };
    const ctx = {
      contextManagementV2,
      compatibilityModes: [],
      assertNotCancelled: async () => {}
    } as ToolDispatchContext;

    await dispatchResponseOutput([{
      type: "custom_tool_call",
      name: "unexpected_custom_tool",
      call_id: "ctc_v2_1",
      input: "{}"
    } as unknown as ResponseOutputItem], ctx, state);

    expect(mocks.recordContextItems).toHaveBeenCalledTimes(2);
    expect(mocks.recordContextItems.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        type: "custom_tool_call",
        call_id: "ctc_v2_1"
      })
    ]);
    expect(mocks.recordContextItems.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({
        type: "custom_tool_call_output",
        call_id: "ctc_v2_1"
      })
    ]);
  });
});
