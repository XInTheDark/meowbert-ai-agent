import { describe, expect, it } from "vitest";
import type { ResponseInputItem, ResponseOutputItem } from "openai/resources/responses/responses";
import type { ContextManagementV2State } from "@meowbert/run-executor/context-management-v2/types";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";
import type { AgentExecutionContext } from "@meowbert/run-executor/agent/execution-types";
import { dispatchResponseOutput } from "@meowbert/run-executor/agent-tool-dispatch/dispatch";
import { applyPendingContextEdits } from "@meowbert/run-executor/agent/context-edits";
import { readContextEdit } from "@meowbert/run-executor/context-management-v2/context-edits";
import { createFakeRunControl } from "../run-host/test-run-environment.test-fixtures.js";

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

function earlierTurn(): ResponseInputItem[] {
  return [
    { role: "user", content: "Find the bug." },
    { type: "function_call", call_id: "call_a", name: "run_shell", arguments: "{}" } as ResponseInputItem,
    { type: "function_call_output", call_id: "call_a", output: "{\"call_number\":7,\"stdout\":\"long listing\"}" } as ResponseInputItem
  ];
}

function setup() {
  const control = createFakeRunControl();
  control.context.loadLastCallNumber.mockResolvedValue(7);
  const state: ToolDispatchState = { conversationItems: earlierTurn(), runPersistedItems: [], commandStep: 0 };
  const ctx = { control, contextManagementV2, compatibilityModes: [], assertNotCancelled: async () => {} } as unknown as ToolDispatchContext;
  const execution = {
    state: { dispatchState: state, contextManagement: contextManagementV2 },
    prepared: { control }
  } as unknown as AgentExecutionContext;
  return { control, state, ctx, execution };
}

const editCall = (args: Record<string, unknown>): ResponseOutputItem => ({
  type: "function_call",
  call_id: "call_edit",
  name: "context_replace_calls",
  arguments: JSON.stringify({ keep_arguments: false, input_summary: "Listed files.", output_summary: "src/parse.ts holds the parser.", ...args })
} as ResponseOutputItem);

describe("context edits through dispatch", () => {
  it("numbers the call after the task's last one and replaces the range once the turn ends", async () => {
    const { control, state, ctx, execution } = setup();

    await dispatchResponseOutput([editCall({ from_call_number: 7, to_call_number: 7 })], ctx, state);

    const editOutput = state.conversationItems.at(-1) as { output: string };
    expect(JSON.parse(editOutput.output)).toMatchObject({ call_number: 8, queued: true });
    expect(await applyPendingContextEdits(execution)).toBe(true);

    expect(state.conversationItems).toHaveLength(2);
    expect(readContextEdit(state.conversationItems[1])).toMatchObject({
      from_call_number: 7,
      to_call_number: 7,
      output_summary: "src/parse.ts holds the parser.",
      edited_by_call_numbers: [8]
    });
    // The transcript and history keep the originals; the summary is added after them.
    expect(state.runPersistedItems.map(readContextEdit).filter(Boolean)).toHaveLength(1);
    const recorded = control.context.recordItems.mock.calls.flatMap(([, records]) => records);
    expect(recorded.filter((record) => record.callNumber === 8)).toHaveLength(2);
  });

  it("reports an invalid range to the model and changes nothing", async () => {
    const { state, ctx, execution } = setup();

    await dispatchResponseOutput([editCall({ from_call_number: 3, to_call_number: 4 })], ctx, state);

    expect((state.conversationItems.at(-1) as { output: string }).output).toContain("No calls 3-4 in the current context.");
    expect(await applyPendingContextEdits(execution)).toBe(false);
    expect(state.conversationItems).toHaveLength(5);
  });
});
