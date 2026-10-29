import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../../lib/types";
import type { ConversationDisplayEntry } from "./conversationActivityEntries";
import { insertMessageAccessories } from "./conversationMessageAccessories";
import { EMPTY_ACTIVITY_TURN_STATE } from "../../task/activityTurnState";

const entry = (id: string): ConversationDisplayEntry => ({ kind: "message", key: id, message: { id } as TaskMessage, showActions: true });

describe("message accessories", () => {
  it("places an accessory after everything shown for its message, or at the end when the message is not shown", () => {
    const entries: ConversationDisplayEntry[] = [
      entry("ask"),
      { kind: "activity", key: "tools", startIndex: 1, messageIds: ["split-call"], toolGroup: [], notices: [], thoughts: [],
        turnState: EMPTY_ACTIVITY_TURN_STATE },
      entry("reply")
    ];
    const result = insertMessageAccessories(entries, [
      { key: "lanes-1", anchorMessageId: "split-call", node: null },
      { key: "lanes-2", anchorMessageId: "not-loaded", node: null }
    ]);
    expect(result.map((item) => item.key)).toEqual(["ask", "tools", "lanes-1", "reply", "lanes-2"]);
  });
});
