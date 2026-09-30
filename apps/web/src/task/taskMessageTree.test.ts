import { describe, expect, it } from "vitest";
import { TaskMessage } from "../lib/types";
import {
  buildTaskMessageTree,
  getSiblingsForMessage,
  resolveLeafFromMessage
} from "./taskMessageTree";

function createMessage(input: {
  id: string;
  role?: TaskMessage["role"];
  parent?: string | null;
  createdAt: string;
}): TaskMessage {
  return {
    id: input.id,
    role: input.role ?? "assistant",
    content_json: { text: input.id },
    parent_message_id: input.parent ?? null,
    edited_from_message_id: null,
    created_at: input.createdAt
  };
}

describe("taskMessageTree helpers", () => {
  const messages: TaskMessage[] = [
    createMessage({ id: "u1", role: "user", createdAt: "2026-02-27T10:00:00.000Z" }),
    createMessage({ id: "a1", createdAt: "2026-02-27T10:00:01.000Z", parent: "u1" }),
    createMessage({ id: "u2a", role: "user", createdAt: "2026-02-27T10:00:02.000Z", parent: "a1" }),
    createMessage({ id: "a2a", createdAt: "2026-02-27T10:00:03.000Z", parent: "u2a" }),
    createMessage({ id: "u2b", role: "user", createdAt: "2026-02-27T10:00:04.000Z", parent: "a1" }),
    createMessage({ id: "a2b", createdAt: "2026-02-27T10:00:05.000Z", parent: "u2b" })
  ];

  it("builds the active path from an explicit active leaf id", () => {
    const tree = buildTaskMessageTree(messages, "a2a");

    expect(tree.activeLeafMessageId).toBe("a2a");
    expect(tree.activePathMessageIds).toEqual(["u1", "a1", "u2a", "a2a"]);
  });

  it("falls back to the newest leaf when requested active leaf is invalid", () => {
    const tree = buildTaskMessageTree(messages, "missing");

    expect(tree.activeLeafMessageId).toBe("a2b");
    expect(tree.activePathMessageIds).toEqual(["u1", "a1", "u2b", "a2b"]);
  });

  it("auto-advances a stale non-leaf selection to the newest descendant leaf", () => {
    const tree = buildTaskMessageTree(messages, "u2b");

    expect(tree.activeLeafMessageId).toBe("a2b");
    expect(tree.activePathMessageIds).toEqual(["u1", "a1", "u2b", "a2b"]);
  });

  it("returns siblings in chronological order", () => {
    const tree = buildTaskMessageTree(messages, "a2b");
    const target = messages.find((message) => message.id === "u2b");
    if (!target) {
      throw new Error("Test message missing");
    }

    const siblings = getSiblingsForMessage(tree, target);

    expect(siblings.map((message) => message.id)).toEqual(["u2a", "u2b"]);
  });

  it("resolves a selected sibling to the newest leaf on that branch", () => {
    const tree = buildTaskMessageTree(messages, "a2a");

    expect(resolveLeafFromMessage(tree, "u2b")).toBe("a2b");
    expect(resolveLeafFromMessage(tree, "u2a")).toBe("a2a");
  });
});
