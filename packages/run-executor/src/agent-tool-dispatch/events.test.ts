import { describe, expect, it } from "vitest";
import { appendToolMessage } from "./events.js";
import type { ToolDispatchContext } from "./types.js";

describe("appendToolMessage", () => {
  it("keeps tool messages from parallel calls on one branch", async () => {
    const parents: Array<string | null> = [];
    let leaf: string | null = "start";
    let count = 0;
    const control = {
      appendMessage: async (input: { parentMessageId: string | null }) => {
        parents.push(input.parentMessageId);
        const id = `message-${++count}`;
        await new Promise((resolve) => setTimeout(resolve, 10 - count));
        return id;
      },
      selectBranch: async () => {}
    };
    const ctx = {
      control,
      getCurrentLeafMessageId: () => leaf,
      setCurrentLeafMessageId: (id: string) => { leaf = id; }
    } as unknown as ToolDispatchContext;

    await Promise.all([1, 2, 3].map((n) => appendToolMessage({ ...ctx, codeModeParentCallId: "exec" }, { n })));

    expect(parents).toEqual(["start", "message-1", "message-2"]);
    expect(leaf).toBe("message-3");
  });
});
