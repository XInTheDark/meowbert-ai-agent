import { describe, expect, it } from "vitest";
import {
  buildMemoryDelta,
  MAX_DELTA_CHARS,
  MAX_DELTA_MESSAGE_CHARS,
  type MemoryDeltaMessage
} from "./delta.js";

function message(index: number, text: string, createdAt?: string): MemoryDeltaMessage {
  return {
    role: index % 2 === 0 ? "user" : "assistant",
    text,
    created_at: createdAt ?? new Date(Date.UTC(2026, 9, 16, 0, 0, index)).toISOString(),
    task_title: "Task"
  };
}

describe("buildMemoryDelta", () => {
  it("includes everything and advances to the last message when under budget", () => {
    const messages = [message(0, "hello"), message(1, "hi there")];
    const delta = buildMemoryDelta(messages);

    expect(delta.markdown).toContain("hello");
    expect(delta.markdown).toContain("hi there");
    expect(delta.throughAt).toBe(messages[1].created_at);
  });

  it("stops the cursor at the last included message when the budget runs out", () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(index, `m${index} ${"x".repeat(MAX_DELTA_MESSAGE_CHARS)}`));
    const delta = buildMemoryDelta(messages);
    const includedCount = (delta.markdown.match(/^## /gm) ?? []).length;

    expect(includedCount).toBeGreaterThan(0);
    expect(includedCount).toBeLessThan(messages.length);
    expect(delta.throughAt).toBe(messages[includedCount - 1].created_at);
    expect(delta.markdown.length).toBeLessThanOrEqual(MAX_DELTA_CHARS + 100);
  });

  it("caps a single long message so later messages still fit", () => {
    const messages = [message(0, "a".repeat(MAX_DELTA_CHARS * 2)), message(1, "follow-up")];
    const delta = buildMemoryDelta(messages);

    expect(delta.markdown).toContain("[Truncated]");
    expect(delta.markdown).toContain("follow-up");
    expect(delta.throughAt).toBe(messages[1].created_at);
  });

  it("does not split messages that share the cursor timestamp", () => {
    const sharedTime = "2026-10-16T00:00:00.000Z";
    const filler = Array.from({ length: 14 }, (_, index) => message(index, "y".repeat(MAX_DELTA_MESSAGE_CHARS)));
    const tied = [message(20, "first tied", sharedTime), message(21, "second tied", sharedTime)];
    const fillerAtSharedTime = filler.map((entry) => ({ ...entry, created_at: sharedTime }));
    const delta = buildMemoryDelta([...fillerAtSharedTime, ...tied]);

    expect(delta.markdown).toContain("second tied");
    expect(delta.throughAt).toBe(sharedTime);
  });
});
