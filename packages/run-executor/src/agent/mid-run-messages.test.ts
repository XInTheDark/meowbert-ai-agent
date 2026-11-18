import { describe, expect, it, vi } from "vitest";
import type { AgentExecutionContext } from "./execution-types.js";
import { publishMidRunMessages } from "./mid-run-messages.js";

function executionWith(messages: string[]) {
  const appendMessage = vi.fn()
    .mockResolvedValueOnce("message-1")
    .mockResolvedValueOnce("message-2");
  const selectBranch = vi.fn(async () => {});
  const emitEvent = vi.fn(async () => {});
  const runPersistedItems = [{ role: "user", content: "work so far" }];
  const execution = {
    job: { runId: "run-1" },
    prepared: {
      control: { appendMessage, selectBranch, emitEvent },
      runPersistedItems,
      runtimeAgentId: "main"
    },
    state: {
      currentLeafMessageId: "leaf",
      contextManagement: { version: "v1" },
      dispatchState: { pendingMidRunMessages: messages }
    }
  } as unknown as AgentExecutionContext;
  return { execution, appendMessage, selectBranch, emitEvent, runPersistedItems };
}

describe("publishMidRunMessages", () => {
  it("posts each message in order on the current branch and refreshes the conversation", async () => {
    const { execution, appendMessage, selectBranch, emitEvent, runPersistedItems } = executionWith(["first", "second"]);

    await publishMidRunMessages(execution);

    expect(appendMessage.mock.calls.map(([input]) => [input.content.text, input.parentMessageId])).toEqual([
      ["first", "leaf"],
      ["second", "message-1"]
    ]);
    expect(appendMessage.mock.calls[0][0].content.response_items).toEqual([{ role: "user", content: "work so far" }]);
    expect(appendMessage.mock.calls[1][0].content.response_items).toBeUndefined();
    expect(runPersistedItems).toEqual([]);
    expect(execution.state.currentLeafMessageId).toBe("message-2");
    expect(selectBranch).toHaveBeenLastCalledWith("message-2");
    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(emitEvent).toHaveBeenCalledWith("notification", expect.objectContaining({ channel: "web", preview: "first" }));
  });

  it("does nothing on a turn without messages", async () => {
    const { execution, appendMessage, runPersistedItems } = executionWith([]);

    await publishMidRunMessages(execution);

    expect(appendMessage).not.toHaveBeenCalled();
    expect(runPersistedItems).toHaveLength(1);
  });
});
