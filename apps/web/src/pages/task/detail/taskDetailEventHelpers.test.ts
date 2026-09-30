import { describe, expect, it } from "vitest";
import { getNetworkRequestReplayText, serializeTaskEventsForClipboard } from "./taskDetailEventHelpers";

describe("serializeTaskEventsForClipboard", () => {
  it("serializes events as readable JSON", () => {
    const serialized = serializeTaskEventsForClipboard([
      {
        id: "evt-1",
        type: "log",
        createdAt: "2026-04-04T00:00:00.000Z",
        payload: {
          message: "hello",
          stage: "startup.workspace_root"
        }
      }
    ]);

    expect(serialized).toContain("\"id\": \"evt-1\"");
    expect(serialized).toContain("\"type\": \"log\"");
    expect(serialized).toContain("\"message\": \"hello\"");
    expect(serialized).toContain("\"stage\": \"startup.workspace_root\"");
  });
});

describe("getNetworkRequestReplayText", () => {
  it("prefers the stored curl replay command when present", () => {
    expect(getNetworkRequestReplayText({
      id: "evt-2",
      type: "log",
      createdAt: "2026-04-07T00:00:00.000Z",
      payload: {
        networkRequest: {
          request: {
            curl: "curl https://api.openai.com/v1/responses"
          }
        }
      }
    })).toBe("curl https://api.openai.com/v1/responses");
  });
});
