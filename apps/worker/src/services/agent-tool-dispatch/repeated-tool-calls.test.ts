import { describe, expect, it } from "vitest";
import { trackRepeatedToolCall } from "./repeated-tool-calls.js";
import type { ToolDispatchState } from "./types.js";

describe("trackRepeatedToolCall", () => {
  it("reminds on the third identical call and resets for changed parameters or another tool", () => {
    const state = { conversationItems: [], runPersistedItems: [], commandStep: 0 } as ToolDispatchState;
    const status = '{"action":"status","session_id":"session-1"}';

    expect(trackRepeatedToolCall(state, "shell_session", status)).toBeNull();
    expect(trackRepeatedToolCall(state, "shell_session", '{"session_id":"session-1","action":"status"}')).toBeNull();
    expect(trackRepeatedToolCall(state, "shell_session", status)).toContain("`wait`");
    expect(trackRepeatedToolCall(state, "shell_session", status)).toContain("`wait`");

    expect(trackRepeatedToolCall(state, "shell_session", '{"action":"status","session_id":"session-2"}')).toBeNull();
    expect(trackRepeatedToolCall(state, "shell_session", status)).toBeNull();
    expect(trackRepeatedToolCall(state, "run_shell", '{"command":"pwd"}')).toBeNull();
    expect(trackRepeatedToolCall(state, "shell_session", status)).toBeNull();
  });
});
