import type { ResponseInputItem } from "openai/resources/responses/responses";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn(async () => "checkpoint-message")
}));

import { appendMessage } from "../agent-db/index.js";
import {
  assertContextTrimCountAvailable,
  checkpointAndTrimContext,
  persistContextCheckpoint
} from "./index.js";

function functionPair(callId: string, name: string): ResponseInputItem[] {
  return [
    {
      type: "function_call",
      call_id: callId,
      name,
      arguments: "{}"
    } as ResponseInputItem,
    {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({ ok: true })
    }
  ];
}

describe("context management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trims the oldest complete tool pairs without removing non-tool messages", async () => {
    const firstPair = functionPair("call-1", "first_tool");
    const secondPair = functionPair("call-2", "second_tool");
    const triggeringPair = functionPair("call-trim", "context_checkpoint_and_trim");
    const conversationItems: ResponseInputItem[] = [
      { role: "user", content: "Keep the request" },
      ...firstPair,
      { role: "assistant", content: "Keep this explanation" },
      ...secondPair,
      ...triggeringPair
    ];
    const runPersistedItems = [...conversationItems];
    let leafMessageId: string | null = "tool-message";

    await checkpointAndTrimContext({
      taskId: "task-1",
      checkpoint: "Continue from the retained state.",
      toolSummary: "The first tool succeeded and returned its expected result.",
      count: 1,
      triggeringCallId: "call-trim",
      conversationItems,
      runPersistedItems,
      getCurrentLeafMessageId: () => leafMessageId,
      setCurrentLeafMessageId: (messageId) => {
        leafMessageId = messageId;
      }
    });

    expect(conversationItems).not.toContain(firstPair[0]);
    expect(conversationItems).not.toContain(firstPair[1]);
    expect(conversationItems).toContain(secondPair[0]);
    expect(conversationItems).toContain(secondPair[1]);
    expect(conversationItems).toContain(triggeringPair[0]);
    expect(conversationItems).toContain(triggeringPair[1]);
    expect(conversationItems).toContainEqual({ role: "user", content: "Keep the request" });
    expect(conversationItems).toContainEqual({ role: "assistant", content: "Keep this explanation" });
    expect(conversationItems.at(-1)).toEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("The first tool succeeded")
    }));
    expect(runPersistedItems).toEqual([]);
    expect(leafMessageId).toBe("checkpoint-message");
    expect(appendMessage).toHaveBeenCalledWith(
      "task-1",
      "system",
      expect.objectContaining({
        kind: "context_checkpoint",
        action: "trim",
        checkpoint: "Continue from the retained state.",
        tool_summary: "The first tool succeeded and returned its expected result.",
        trimmed_tool_count: 1,
        response_items: conversationItems
      }),
      { parentMessageId: "tool-message" }
    );
  });

  it("rejects an imprecise count that exceeds the complete pairs available before the trim call", () => {
    const conversationItems: ResponseInputItem[] = [
      ...functionPair("call-1", "first_tool"),
      {
        type: "function_call",
        call_id: "incomplete",
        name: "unfinished_tool",
        arguments: "{}"
      } as ResponseInputItem,
      ...functionPair("call-trim", "context_checkpoint_and_trim")
    ];

    expect(() => assertContextTrimCountAvailable({
      conversationItems,
      triggeringCallId: "call-trim",
      count: 2
    })).toThrow("only 1 complete call/output pairs are available");
  });

  it("persists a compact checkpoint without invoking another compaction implementation", async () => {
    const conversationItems: ResponseInputItem[] = [{ role: "system", content: "Compacted provider state" }];
    const runPersistedItems: ResponseInputItem[] = [];

    await persistContextCheckpoint({
      taskId: "task-compact",
      action: "compact",
      checkpoint: "The compacted run should continue with the remaining tests.",
      conversationItems,
      runPersistedItems,
      getCurrentLeafMessageId: () => "compaction-marker",
      setCurrentLeafMessageId: () => undefined
    });

    expect(conversationItems.at(-1)).toEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("The compacted run should continue")
    }));
    expect(appendMessage).toHaveBeenCalledWith(
      "task-compact",
      "system",
      expect.objectContaining({
        kind: "context_checkpoint",
        action: "compact",
        response_items: conversationItems
      }),
      { parentMessageId: "compaction-marker" }
    );
  });
});
