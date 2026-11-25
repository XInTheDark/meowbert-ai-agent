import { describe, expect, it, vi } from "vitest";
import type { ContextManagementV2State } from "../../context-management-v2/types.js";
import { NOTES_WRITE_FILE_TOOL_NAME, buildResponseTools } from "../../agent-tools/index.js";
import { buildCodeModeToolSet } from "../../code-mode/code-mode-tools.js";
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
import { NOTES_READ_MAX_CHARS, handleContextManagementV2Tool } from "./context-management-v2.js";
import { NOTES_SEARCH_MAX_LINE_CHARS, NOTES_SEARCH_MAX_TOTAL_CHARS, boundNoteSearchResults } from "../../context-management-v2/window.js";

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
  it("offers and executes note reads directly in a code-mode notes-only turn", async () => {
    const tools = buildCodeModeToolSet(buildResponseTools({ webSearch: false, memorySearch: false,
      scheduleTask: false, subtasks: false, computerUse: false, enabledSkills: [], enabledSources: [] },
    [], { contextManagementVersion: "v2" }), 60);
    expect(tools.responseTools).toContainEqual(expect.objectContaining({ type: "function", name: "notes_read_file" }));
    expect(tools.nestedTools.some((tool) => tool.name === "notes_read_file")).toBe(false);
    const readNote = vi.fn(async () => ({ path: "continuity.md", text: "Intermediate results" }));
    const ctx = { notesOnly: true, contextManagementV2, compatibilityModes: [], assertNotCancelled: async () => {},
      control: { context: { readNote, loadLastCallNumber: async () => 0 },
        recordToolCallStart: async () => {}, recordToolCallResult: async () => {} }
    } as unknown as ToolDispatchContext;
    const state = { conversationItems: [], runPersistedItems: [], commandStep: 0 } as unknown as ToolDispatchState;

    await dispatchResponseOutput([{ type: "function_call", name: "notes_read_file", call_id: "read",
      arguments: JSON.stringify({ path: "continuity.md", start_line: null, stop_line: null }) }], ctx, state);

    expect(readNote).toHaveBeenCalledOnce();
    const output = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(output).toMatchObject({ call_id: "read", output: expect.stringContaining("Intermediate results") });
  });

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
    const control = { context: { writeNote: mocks.writeNote, loadLastCallNumber: async () => 0 }, recordToolCallStart: async () => {}, recordToolCallResult: async () => {} };
    const ctx = { control, contextManagementV2, compatibilityModes: [], assertNotCancelled: async () => {} } as unknown as ToolDispatchContext;

    await dispatchResponseOutput([call], ctx, state);

    const output = state.runPersistedItems.find((item) => item.type === "function_call_output");
    expect(output).toMatchObject({ call_id: "call-1" });
    expect(mocks.recordContextItems).toHaveBeenLastCalledWith(control.context, contextManagementV2, [output]);
    expect(JSON.parse((output as { output: string }).output)).toEqual({
      call_number: 1,
      updated: true,
      context: "Model request that produced this tool call: 64000 / 256000 tokens (25%)."
    });
  });

  it("runs only notes tools in a notes-only turn and refuses the rest", async () => {
    mocks.writeNote.mockClear();
    mocks.writeNote.mockResolvedValue({ path: "notes/continuity.md", updated: true });
    const noteCall = {
      type: "function_call",
      call_id: "call-note",
      name: NOTES_WRITE_FILE_TOOL_NAME,
      arguments: JSON.stringify({ path: "notes/continuity.md", text: "Waiting on the deploy report." })
    } as never;
    const answerCall = {
      type: "function_call",
      call_id: "call-answer",
      name: "final_response",
      arguments: JSON.stringify({ response: "All done.", notify: true })
    } as never;
    const state = { conversationItems: [], runPersistedItems: [], commandStep: 0 } as unknown as ToolDispatchState;
    const control = { context: { writeNote: mocks.writeNote, loadLastCallNumber: async () => 0 }, recordToolCallStart: async () => {}, recordToolCallResult: async () => {} };
    const ctx = { control, contextManagementV2, notesOnly: true, compatibilityModes: [], assertNotCancelled: async () => {} } as unknown as ToolDispatchContext;

    const result = await dispatchResponseOutput([noteCall, answerCall], ctx, state);

    expect(mocks.writeNote).toHaveBeenCalledTimes(1);
    expect(result.finalResponse).toBeNull();
    const refused = state.runPersistedItems.find((item) => item.type === "function_call_output" && item.call_id === "call-answer");
    expect((refused as { output: string }).output).toContain("Only the notes tools are available");
  });

  it("caps oversized notes_read_file output while leaving normal notes intact", async () => {
    const readNote = vi.fn()
      .mockResolvedValueOnce({ path: "normal.md", content: "hello", start_line: 1, stop_line: 1 })
      .mockResolvedValueOnce({ path: "huge.md", content: "x".repeat(NOTES_READ_MAX_CHARS + 500), start_line: 1, stop_line: 1 });
    const ctx = { control: { context: { readNote } }, contextManagementV2 } as unknown as ToolDispatchContext;
    const state = { conversationItems: [], runPersistedItems: [], commandStep: 0 } as unknown as ToolDispatchState;

    const normal = await handleContextManagementV2Tool({
      type: "function_call", call_id: "read-1", name: "notes_read_file",
      arguments: JSON.stringify({ path: "normal.md", start_line: null, stop_line: null })
    } as never, ctx, state);
    expect(normal.output).toEqual({ path: "normal.md", content: "hello", start_line: 1, stop_line: 1 });

    const huge = await handleContextManagementV2Tool({
      type: "function_call", call_id: "read-2", name: "notes_read_file",
      arguments: JSON.stringify({ path: "huge.md", start_line: null, stop_line: null })
    } as never, ctx, state);
    const hugeOutput = huge.output as { content: string; truncated: boolean };
    expect(hugeOutput.truncated).toBe(true);
    expect(hugeOutput.content.length).toBeLessThan(NOTES_READ_MAX_CHARS + 200);
    expect(hugeOutput.content).toContain("Use start_line and stop_line");
  });

  it("bounds notes_search_contents line lengths and total size", () => {
    const files = Array.from({ length: 10 }, (_, fileIndex) => ({
      path: `note-${fileIndex}.md`,
      matches: Array.from({ length: 15 }, (_, lineIndex) => ({
        line: lineIndex + 1,
        content: `match-${fileIndex}-${lineIndex}-${"a".repeat(NOTES_SEARCH_MAX_LINE_CHARS + 200)}`
      }))
    }));

    const bounded = boundNoteSearchResults(files);

    expect(bounded.truncated).toBe(true);
    expect(bounded.files[0]?.matches[0]?.content.length).toBe(NOTES_SEARCH_MAX_LINE_CHARS);
    expect(JSON.stringify(bounded.files).length).toBeLessThanOrEqual(NOTES_SEARCH_MAX_TOTAL_CHARS + 500);
  });
});
