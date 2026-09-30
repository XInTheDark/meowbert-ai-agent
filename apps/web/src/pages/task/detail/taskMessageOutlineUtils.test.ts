// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../../../lib/types";
import {
  buildTaskMessageOutlineItems,
  getTaskMessageOutlineScrollTopForIndex,
  getTaskMessageOutlineVirtualWindow,
  resolveActiveOutlineMessageId,
  TASK_MESSAGE_OUTLINE_ROW_HEIGHT
} from "./taskMessageOutlineUtils";

function buildMessage(overrides: Partial<TaskMessage>): TaskMessage {
  return {
    id: "message-1",
    role: "assistant",
    content_json: { text: "Hello there" },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-03-30T00:00:00.000Z",
    ...overrides
  };
}

describe("taskMessageOutlineUtils", () => {
  it("builds compact outline items for user and assistant messages only", () => {
    const items = buildTaskMessageOutlineItems([
      buildMessage({ id: "user-1", role: "user", content_json: { text: "Hi" } }),
      buildMessage({ id: "tool-1", role: "tool", content_json: { text: "ignored" } }),
      buildMessage({
        id: "assistant-1",
        role: "assistant",
        content_json: {
          text: "Here is **markdown** with `code` and [a link](https://example.com)."
        }
      })
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "user-1", label: "You" });
    expect(items[1]?.preview).toContain("Here is markdown with code and a link.");
  });

  it("prefers a safe fallback preview when the content is still metadata-only", () => {
    const items = buildTaskMessageOutlineItems([
      buildMessage({ id: "assistant-1", content_json: {} })
    ]);

    expect(items[0]?.preview).toContain("Preview loads when this reply is in view.");
  });

  it("resolves the active outline message from rendered feed nodes only", () => {
    const feed = document.createElement("div");
    Object.defineProperty(feed, "scrollTop", { value: 120, configurable: true });
    Object.defineProperty(feed, "clientHeight", { value: 300, configurable: true });

    const renderedOlder = document.createElement("div");
    renderedOlder.dataset.messageId = "message-2";
    Object.defineProperty(renderedOlder, "offsetTop", { value: 140, configurable: true });

    const renderedNewer = document.createElement("div");
    renderedNewer.dataset.messageId = "message-3";
    Object.defineProperty(renderedNewer, "offsetTop", { value: 250, configurable: true });

    feed.append(renderedOlder, renderedNewer);

    const activeId = resolveActiveOutlineMessageId(feed, new Set(["message-1", "message-2", "message-3"]));

    expect(activeId).toBe("message-2");
  });

  it("computes a stable virtual window for large outline lists", () => {
    const window = getTaskMessageOutlineVirtualWindow({
      scrollTop: TASK_MESSAGE_OUTLINE_ROW_HEIGHT * 40,
      viewportHeight: TASK_MESSAGE_OUTLINE_ROW_HEIGHT * 6,
      totalItems: 300
    });

    expect(window.startIndex).toBeLessThanOrEqual(40);
    expect(window.endIndex).toBeGreaterThan(46);
    expect(window.totalHeight).toBe(300 * TASK_MESSAGE_OUTLINE_ROW_HEIGHT);
  });

  it("maps row indices to deterministic scroll positions", () => {
    expect(getTaskMessageOutlineScrollTopForIndex(0)).toBe(0);
    expect(getTaskMessageOutlineScrollTopForIndex(3)).toBe(TASK_MESSAGE_OUTLINE_ROW_HEIGHT * 3);
  });
});
