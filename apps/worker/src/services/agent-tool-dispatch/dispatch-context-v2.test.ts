import { describe, expect, it, vi } from "vitest";
import type { ResponseOutputItem } from "openai/resources/responses/responses";
import type { ContextManagementV2State } from "@meowbert/run-executor/context-management-v2/types";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";

const mocks = vi.hoisted(() => ({
  handleApplyPatch: vi.fn(),
  recordContextItems: vi.fn(async () => {})
}));

vi.mock("@meowbert/run-executor/context-management-v2/window", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meowbert/run-executor/context-management-v2/window")>();
  return {
    ...actual,
    recordContextItems: mocks.recordContextItems
  };
});

vi.mock("@meowbert/run-executor/agent-tool-dispatch/handlers/apply-patch", () => ({
  handleApplyPatch: mocks.handleApplyPatch
}));

import { GET_CONTEXT_REMAINING_TOOL_NAME } from "@meowbert/run-executor/agent-tools/index";
import { dispatchResponseOutput } from "@meowbert/run-executor/agent-tool-dispatch/dispatch";
import { createTestRunControl } from "../run-host/test-run-environment.test-fixtures.js";

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
  it("records the output apply_patch returns for a custom tool call", async () => {
    mocks.recordContextItems.mockClear();
    mocks.handleApplyPatch.mockResolvedValueOnce({ output: "done", status: "completed" });
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };
    const ctx = {
      control: createTestRunControl(),
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
    expect(mocks.recordContextItems.mock.calls[1]?.[2]).toEqual([
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
      control: createTestRunControl(),
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
    expect(mocks.recordContextItems.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({
        type: "custom_tool_call",
        call_id: "ctc_v2_1"
      })
    ]);
    expect(mocks.recordContextItems.mock.calls[1]?.[2]).toEqual([
      expect.objectContaining({
        type: "custom_tool_call_output",
        call_id: "ctc_v2_1"
      })
    ]);
  });

  it("replays a parallel batch as all calls before any output, recording each call once", async () => {
    mocks.recordContextItems.mockClear();
    const state: ToolDispatchState = {
      conversationItems: [],
      runPersistedItems: [],
      commandStep: 0
    };
    const ctx = {
      control: createTestRunControl(),
      contextManagementV2,
      compatibilityModes: [],
      assertNotCancelled: async () => {}
    } as ToolDispatchContext;

    await dispatchResponseOutput([
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Checking both.", annotations: [] }]
      },
      { type: "function_call", call_id: "call_a", name: GET_CONTEXT_REMAINING_TOOL_NAME, arguments: "{}" },
      { type: "custom_tool_call", call_id: "call_b", name: "unexpected_custom_tool", input: "{}" }
    ] as unknown as ResponseOutputItem[], ctx, state);

    const sequence = state.conversationItems.map((item) => {
      const record = item as { type?: string; role?: string; call_id?: string };
      return record.call_id ? `${record.type}:${record.call_id}` : `${record.type}:${record.role}`;
    });
    expect(sequence).toEqual([
      "message:assistant",
      "function_call:call_a",
      "custom_tool_call:call_b",
      "function_call_output:call_a",
      "custom_tool_call_output:call_b"
    ]);
    expect(state.runPersistedItems).toEqual(state.conversationItems);
  });
});
