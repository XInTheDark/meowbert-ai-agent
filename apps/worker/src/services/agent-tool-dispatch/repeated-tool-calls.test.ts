import { describe, expect, it } from "vitest";
import { trackRepeatedToolCall } from "./repeated-tool-calls.js";
import type { ToolDispatchState } from "./types.js";

describe("trackRepeatedToolCall", () => {
  it("reminds on the third identical call and resets for changed parameters or another tool", () => {
    const state = { conversationItems: [], runPersistedItems: [], commandStep: 0 } as ToolDispatchState;
    const view = '{"start":[],"stop":[],"view_only":true}';

    expect(trackRepeatedToolCall(state, "swarm_manage", view)).toBeNull();
    expect(trackRepeatedToolCall(state, "swarm_manage", '{"view_only":true,"stop":[],"start":[]}')).toBeNull();
    expect(trackRepeatedToolCall(state, "swarm_manage", view)).toContain("swarm_pause");
    expect(trackRepeatedToolCall(state, "swarm_manage", view)).toContain("swarm_pause");

    expect(trackRepeatedToolCall(state, "swarm_manage", '{"start":["Worker 1"],"stop":[],"view_only":false}')).toBeNull();
    expect(trackRepeatedToolCall(state, "swarm_manage", view)).toBeNull();
    expect(trackRepeatedToolCall(state, "run_shell", '{"command":"pwd"}')).toBeNull();
    expect(trackRepeatedToolCall(state, "swarm_manage", view)).toBeNull();

    const status = '{"action":"status","session_id":"session-1"}';
    expect(trackRepeatedToolCall(state, "shell_session", status)).toBeNull();
    expect(trackRepeatedToolCall(state, "shell_session", status)).toBeNull();
    expect(trackRepeatedToolCall(state, "shell_session", status)).toContain("`wait`");
  });
});
