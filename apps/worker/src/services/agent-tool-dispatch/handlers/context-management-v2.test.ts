import { describe, expect, it, vi } from "vitest";
import type { ContextManagementV2State } from "../../context-management-v2/types.js";
import { NOTES_WRITE_FILE_TOOL_NAME } from "../../agent-tools/index.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

const mocks = vi.hoisted(() => ({
  listContextItems: vi.fn(),
  listContextNotes: vi.fn(),
  listContextWindows: vi.fn(),
  mutateContextNote: vi.fn(),
  readContextItem: vi.fn(),
  readContextNote: vi.fn(),
  recordContextItems: vi.fn(),
  searchContextHistory: vi.fn(),
  searchContextNotes: vi.fn()
}));

vi.mock("../../context-management-v2/index.js", () => mocks);

import { handleContextManagementV2Tool } from "./context-management-v2.js";

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

describe("handleContextManagementV2Tool", () => {
  it("persists context tool activity for the task conversation", async () => {
    mocks.mutateContextNote.mockResolvedValue({ path: "notes/continuity.md", updated: true });
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
    const ctx = { contextManagementV2 } as ToolDispatchContext;

    await handleContextManagementV2Tool(call, ctx, state);

    expect(state.runPersistedItems).toHaveLength(2);
    expect(state.runPersistedItems[0]).toBe(call);
    expect(state.runPersistedItems[1]).toMatchObject({
      type: "function_call_output",
      call_id: "call-1"
    });
    expect(JSON.parse((state.runPersistedItems[1] as { output: string }).output)).toEqual({
      updated: true,
      context: "Model request that produced this tool call: 64000 / 256000 tokens (25%)."
    });
  });
});
