import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn()
}));

import { appendMessage } from "../agent-db/index.js";
import {
  insertMissingToolOutputItem,
  parseMissingToolOutput,
  parseMissingToolOutputCallId,
  persistModelRequestRecovery,
  replaceLastRecoverableRequestItem
} from "./model-request-recovery.js";

const mockedAppendMessage = vi.mocked(appendMessage);

describe("model request recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces recent items from the tail while retaining earlier recovery notices", () => {
    const output = {
      type: "function_call_output",
      call_id: "call_1",
      output: "tool output"
    } as const;
    const observation = {
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,invalid" }]
    } as const;
    const items = [
      { type: "function_call", call_id: "call_1", name: "view_image", arguments: "{}" },
      observation,
      output
    ] as never[];

    const firstRecovery = replaceLastRecoverableRequestItem({
      conversationItems: items,
      errorMessage: "invalid image"
    });
    const secondRecovery = replaceLastRecoverableRequestItem({
      conversationItems: firstRecovery!,
      errorMessage: "invalid image"
    });

    expect(firstRecovery).toEqual([
      items[0],
      observation,
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("invalid image")
      })
    ]);
    expect(secondRecovery).toEqual([
      items[0],
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("invalid image")
      }),
      firstRecovery![2]
    ]);
  });

  it("persists the repaired conversation and clears transient run items", async () => {
    mockedAppendMessage.mockResolvedValue("recovery-message-1");
    const conversationItems = [
      { role: "user", content: "original request" },
      { type: "function_call_output", call_id: "call_1", output: "bad result" }
    ] as never[];
    const runPersistedItems = [...conversationItems];
    let currentLeafMessageId: string | null = "message-1";

    await expect(persistModelRequestRecovery({
      taskId: "task-1",
      errorMessage: "400 invalid image",
      conversationItems,
      runPersistedItems,
      getCurrentLeafMessageId: () => currentLeafMessageId,
      setCurrentLeafMessageId: (messageId) => {
        currentLeafMessageId = messageId;
      }
    })).resolves.toBe(true);

    expect(conversationItems).toEqual([
      { role: "user", content: "original request" },
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("400 invalid image")
      })
    ]);
    expect(runPersistedItems).toEqual([]);
    expect(currentLeafMessageId).toBe("recovery-message-1");
    expect(mockedAppendMessage).toHaveBeenCalledWith("task-1", "system", expect.objectContaining({
      response_items: conversationItems
    }), { parentMessageId: "message-1" });
  });

  describe("parseMissingToolOutputCallId", () => {
    it("parses call ID from standard missing tool output provider errors", () => {
      expect(
        parseMissingToolOutputCallId(
          "400 No tool output found for function call call_R3KCF83wYt9Wc5NYBwnbhn42."
        )
      ).toBe("call_R3KCF83wYt9Wc5NYBwnbhn42");

      expect(
        parseMissingToolOutputCallId(
          "Provider error: 400 No tool output found for function call call_R3KCF83wYt9Wc5NYBwnbhn42."
        )
      ).toBe("call_R3KCF83wYt9Wc5NYBwnbhn42");

      expect(
        parseMissingToolOutputCallId(
          "No tool output found for function call 'call_abc_123'."
        )
      ).toBe("call_abc_123");

      expect(
        parseMissingToolOutputCallId(
          "missing tool output for function call call_xyz"
        )
      ).toBe("call_xyz");

      expect(
        parseMissingToolOutputCallId(
          "400 No tool output found for custom tool call ctc_UoAd8ephmWzW3mrhX3neGMmG."
        )
      ).toBe("ctc_UoAd8ephmWzW3mrhX3neGMmG");
      expect(parseMissingToolOutput(
        "400 No tool output found for custom tool call ctc_UoAd8ephmWzW3mrhX3neGMmG."
      )).toEqual({
        callId: "ctc_UoAd8ephmWzW3mrhX3neGMmG",
        kind: "custom_tool_call"
      });
      expect(parseMissingToolOutput(
        "400 No tool output found for apply_patch_call call_patch_native."
      )).toEqual({
        callId: "call_patch_native",
        kind: "apply_patch_call"
      });
      expect(parseMissingToolOutputCallId(
        "No tool output found for apply patch tool call call_patch_spaced"
      )).toBe("call_patch_spaced");

      expect(
        parseMissingToolOutputCallId(
          new Error("400 No tool output found for function call call_from_error.")
        )
      ).toBe("call_from_error");

      expect(
        parseMissingToolOutputCallId({
          error: {
            message: "400 No tool output found for function call call_nested."
          }
        })
      ).toBe("call_nested");
    });

    it("returns null for non-matching error messages", () => {
      expect(parseMissingToolOutputCallId("400 invalid image")).toBeNull();
      expect(parseMissingToolOutputCallId("Rate limit exceeded")).toBeNull();
      expect(parseMissingToolOutputCallId("Internal server error")).toBeNull();
    });
  });

  describe("insertMissingToolOutputItem", () => {
    it("finds the corresponding call and inserts the function output item immediately next to it", () => {
      const items = [
        { role: "user", content: "hello" },
        { type: "function_call", call_id: "call_R3KCF83wYt9Wc5NYBwnbhn42", name: "run_shell", arguments: "{}" },
        { role: "user", content: "next prompt" }
      ] as never[];

      const repaired = insertMissingToolOutputItem({
        conversationItems: items,
        callId: "call_R3KCF83wYt9Wc5NYBwnbhn42"
      });

      expect(repaired).toEqual([
        items[0],
        items[1],
        {
          type: "function_call_output",
          call_id: "call_R3KCF83wYt9Wc5NYBwnbhn42",
          output: "system: an error occurred"
        },
        items[2]
      ]);
    });

    it("inserts next to the specific call when multiple calls exist", () => {
      const call1 = { type: "function_call", call_id: "call_1", name: "tool1", arguments: "{}" };
      const call2 = { type: "function_call", call_id: "call_2", name: "tool2", arguments: "{}" };
      const items = [call1, call2] as never[];

      const repaired = insertMissingToolOutputItem({
        conversationItems: items,
        callId: "call_1"
      });

      expect(repaired).toEqual([
        call1,
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "system: an error occurred"
        },
        call2
      ]);
    });

    it("uses the call_id when the provider reports the function call item id", () => {
      const call = {
        type: "function_call",
        id: "fc_123",
        call_id: "call_123",
        name: "run_shell",
        arguments: "{}"
      };
      const items = [call, { type: "function_call_output", call_id: "call_123", output: "old" }] as never[];

      expect(insertMissingToolOutputItem({
        conversationItems: items,
        callId: "fc_123"
      })).toEqual([
        call,
        { type: "function_call_output", call_id: "call_123", output: "system: an error occurred" }
      ]);
    });

    it("does not append an output item when the reported call is not in the request", () => {
      const items = [{ role: "user", content: "hello" }] as never[];

      const repaired = insertMissingToolOutputItem({
        conversationItems: items,
        callId: "call_missing"
      });

      expect(repaired).toBeNull();
    });

    it("inserts a custom_tool_call_output for a custom tool call", () => {
      const items = [{
        type: "custom_tool_call",
        call_id: "ctc_1",
        name: "apply_patch",
        input: "*** Begin Patch\n*** End Patch"
      }] as never[];

      expect(insertMissingToolOutputItem({
        conversationItems: items,
        callId: "ctc_1"
      })).toEqual([
        items[0],
        {
          type: "custom_tool_call_output",
          call_id: "ctc_1",
          output: "system: an error occurred"
        }
      ]);
    });

    it("inserts an apply_patch_call_output for a native apply patch call", () => {
      const items = [{
        type: "apply_patch_call",
        call_id: "apc_1",
        operation: {}
      }] as never[];

      expect(insertMissingToolOutputItem({
        conversationItems: items,
        callId: "apc_1"
      })).toEqual([
        items[0],
        {
          type: "apply_patch_call_output",
          call_id: "apc_1",
          status: "failed",
          output: "system: an error occurred"
        }
      ]);
    });
  });

  it("removes recent request items immediately when the reported item id cannot be matched", async () => {
    mockedAppendMessage.mockResolvedValue("recovery-msg-unmatched");
    const firstCall = { type: "function_call", call_id: "call_1", name: "run_shell", arguments: "{}" };
    const firstOutput = { type: "function_call_output", call_id: "call_1", output: "first" };
    const secondCall = { type: "function_call", call_id: "call_2", name: "run_shell", arguments: "{}" };
    const secondOutput = { type: "function_call_output", call_id: "call_2", output: "second" };
    const conversationItems = [
      { role: "user", content: "run this" }, firstCall, firstOutput, secondCall, secondOutput
    ] as never[];
    const runPersistedItems = [...conversationItems];

    expect(await persistModelRequestRecovery({
      taskId: "task-unmatched",
      errorMessage: "400 No tool output found for function call fc_unknown.",
      conversationItems,
      runPersistedItems,
      getCurrentLeafMessageId: () => "previous-msg",
      setCurrentLeafMessageId: () => {}
    })).toBe(true);

    expect(conversationItems).toEqual([
      { role: "user", content: "run this" },
      firstCall,
      firstOutput,
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Recent request history was trimmed")
      })
    ]);
    expect(runPersistedItems).toEqual([]);
    expect(mockedAppendMessage).toHaveBeenCalledWith("task-unmatched", "system", expect.objectContaining({
      text: expect.stringContaining("Recent request history was trimmed"),
      response_items: conversationItems
    }), { parentMessageId: "previous-msg" });

    const secondRecovery = replaceLastRecoverableRequestItem({
      conversationItems,
      errorMessage: "400 No tool output found for function call fc_unknown."
    });
    expect(secondRecovery).toEqual([
      { role: "user", content: "run this" },
      expect.objectContaining({ role: "system", content: expect.stringContaining("Recent request history was trimmed") }),
      conversationItems[3]
    ]);
  });

  it("recovers and persists missing tool output errors by inserting function_call_output next to call", async () => {
    mockedAppendMessage.mockResolvedValue("recovery-msg-tool");
    const callItem = {
      type: "function_call",
      call_id: "call_R3KCF83wYt9Wc5NYBwnbhn42",
      name: "run_shell",
      arguments: "{}"
    };
    const conversationItems = [
      { role: "user", content: "please run something" },
      callItem
    ] as never[];
    const runPersistedItems = [...conversationItems];
    let currentLeafMessageId: string | null = "msg-prev";

    const recovered = await persistModelRequestRecovery({
      taskId: "task-missing-tool",
      errorMessage: "400 No tool output found for function call call_R3KCF83wYt9Wc5NYBwnbhn42.",
      conversationItems,
      runPersistedItems,
      getCurrentLeafMessageId: () => currentLeafMessageId,
      setCurrentLeafMessageId: (id) => {
        currentLeafMessageId = id;
      }
    });

    expect(recovered).toBe(true);
    expect(conversationItems).toEqual([
      { role: "user", content: "please run something" },
      callItem,
      {
        type: "function_call_output",
        call_id: "call_R3KCF83wYt9Wc5NYBwnbhn42",
        output: JSON.stringify({ error: "Recovered missing function_call_output from historical task state." })
      }
    ]);
    expect(runPersistedItems).toEqual([]);
    expect(currentLeafMessageId).toBe("recovery-msg-tool");
    expect(mockedAppendMessage).toHaveBeenCalledWith("task-missing-tool", "system", expect.objectContaining({
      text: "[System: Reconstructed tool output history for function call call_R3KCF83wYt9Wc5NYBwnbhn42.]",
      response_items: conversationItems
    }), { parentMessageId: "msg-prev" });
  });

  it("recovers custom tool output errors with the matching custom output type", async () => {
    mockedAppendMessage.mockResolvedValue("recovery-msg-custom");
    const callItem = {
      type: "custom_tool_call",
      call_id: "ctc_UoAd8ephmWzW3mrhX3neGMmG",
      name: "apply_patch",
      input: "*** Begin Patch\n*** End Patch"
    };
    const conversationItems = [callItem] as never[];
    const runPersistedItems = [...conversationItems];
    let currentLeafMessageId: string | null = "msg-prev";

    const recovered = await persistModelRequestRecovery({
      taskId: "task-missing-custom-tool",
      errorMessage: "400 No tool output found for custom tool call ctc_UoAd8ephmWzW3mrhX3neGMmG.",
      conversationItems,
      runPersistedItems,
      getCurrentLeafMessageId: () => currentLeafMessageId,
      setCurrentLeafMessageId: (id) => {
        currentLeafMessageId = id;
      }
    });

    expect(recovered).toBe(true);
    expect(conversationItems).toEqual([
      callItem,
      {
        type: "custom_tool_call_output",
        call_id: "ctc_UoAd8ephmWzW3mrhX3neGMmG",
        output: "Recovered missing custom_tool_call_output from historical task state."
      }
    ]);
    expect(currentLeafMessageId).toBe("recovery-msg-custom");
    expect(mockedAppendMessage).toHaveBeenCalledWith("task-missing-custom-tool", "system", expect.objectContaining({
      text: "[System: Reconstructed tool output history for custom tool call ctc_UoAd8ephmWzW3mrhX3neGMmG.]",
      response_items: conversationItems
    }), { parentMessageId: "msg-prev" });
  });

  it("restores the actual tool output from already loaded task history", async () => {
    mockedAppendMessage.mockResolvedValue("recovery-msg-history");
    const call = { type: "function_call", call_id: "call_history", name: "run_shell", arguments: "{}" };
    const conversationItems = [{ role: "user", content: "run this" }, call] as never[];

    await persistModelRequestRecovery({
      taskId: "task-history",
      errorMessage: "No tool output found for function call call_history",
      conversationItems,
      runPersistedItems: [],
      historicalMessages: [{
        role: "tool",
        content_json: {
          response_function_output: { call_id: "call_history", output: "actual stored result" }
        }
      }] as never,
      getCurrentLeafMessageId: () => "previous-msg",
      setCurrentLeafMessageId: () => {}
    });

    expect(conversationItems).toEqual([
      { role: "user", content: "run this" },
      call,
      { type: "function_call_output", call_id: "call_history", output: "actual stored result" }
    ]);
  });

  it("trims a reported pair when reconstruction would retry the same payload", async () => {
    mockedAppendMessage.mockResolvedValue("recovery-msg-repeat");
    const conversationItems = [
      { role: "user", content: "run this" },
      { type: "function_call", call_id: "call_repeat", name: "run_shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call_repeat", output: "stored result" },
      { role: "user", content: "later request" }
    ] as never[];

    await persistModelRequestRecovery({
      taskId: "task-repeat",
      errorMessage: "No tool output found for function call call_repeat",
      conversationItems,
      runPersistedItems: [],
      getCurrentLeafMessageId: () => "previous-msg",
      setCurrentLeafMessageId: () => {}
    });

    expect(conversationItems).toEqual([
      { role: "user", content: "run this" },
      { role: "user", content: "later request" },
      expect.objectContaining({ role: "system", content: expect.stringContaining("history was trimmed") })
    ]);
  });
});
