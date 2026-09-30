import { describe, expect, it } from "vitest";
import { getConsecutiveModelRetryGroup, parseModelRetryMessage } from "./taskConversationDisplay";
import type { TaskMessage } from "../lib/types";

function buildMessage(
  id: string,
  role: TaskMessage["role"],
  text: string,
  createdAt: string
): TaskMessage {
  return {
    id,
    role,
    content_json: { text },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: createdAt
  };
}

describe("taskConversationDisplay", () => {
  it("parses model retry notices", () => {
    expect(
      parseModelRetryMessage(
        "Model request failed (attempt 5/6): 500 auth_unavailable: no auth available. Retrying in 48s..."
      )
    ).toEqual({
      attempt: 5,
      maxAttempts: 6,
      error: "500 auth_unavailable: no auth available",
      retryInSeconds: 48
    });
  });

  it("collapses consecutive retry notices to the latest message", () => {
    const messages = [
      buildMessage(
        "m1",
        "system",
        "Model request failed (attempt 1/6): temporary outage. Retrying in 3s...",
        "2026-03-04T08:00:00.000Z"
      ),
      buildMessage(
        "m2",
        "system",
        "Model request failed (attempt 2/6): temporary outage. Retrying in 6s...",
        "2026-03-04T08:00:03.000Z"
      ),
      buildMessage("m3", "assistant", "Recovered", "2026-03-04T08:00:09.000Z")
    ];

    expect(getConsecutiveModelRetryGroup(messages, 0)).toEqual({
      hiddenCount: 1,
      isActive: false,
      latestMessage: messages[1],
      latestDetails: {
        attempt: 2,
        maxAttempts: 6,
        error: "temporary outage",
        retryInSeconds: 6
      },
      nextIndex: 2
    });
    expect(getConsecutiveModelRetryGroup(messages, 2)).toBeNull();
  });

  it("marks the trailing retry group as active", () => {
    const messages = [
      buildMessage(
        "m1",
        "system",
        "Model request failed (attempt 1/6): temporary outage. Retrying in 3s...",
        "2026-03-04T08:00:00.000Z"
      ),
      buildMessage(
        "m2",
        "system",
        "Model request failed (attempt 2/6): temporary outage. Retrying in 6s...",
        "2026-03-04T08:00:03.000Z"
      )
    ];

    expect(getConsecutiveModelRetryGroup(messages, 0)).toEqual({
      hiddenCount: 1,
      isActive: true,
      latestMessage: messages[1],
      latestDetails: {
        attempt: 2,
        maxAttempts: 6,
        error: "temporary outage",
        retryInSeconds: 6
      },
      nextIndex: 2
    });
  });
});
