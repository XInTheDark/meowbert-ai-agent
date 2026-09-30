import { describe, expect, it } from "vitest";
import {
  appendTaskMessageMetadataLine,
  buildTaskMessageMetadataLine,
  createTaskMessageMetadata,
  normalizeTaskMessageMetadata
} from "./task-message-metadata.js";

describe("task-message-metadata", () => {
  it("normalizes valid metadata objects", () => {
    expect(normalizeTaskMessageMetadata({
      message_time: "2026-04-12T12:00:00.000Z",
      agent_id: " default ",
      reasoning_content_count: 0
    })).toEqual({
      message_time: "2026-04-12T12:00:00.000Z",
      agent_id: "default",
      reasoning_content_count: 0
    });
  });

  it("normalizes a preserved reasoning content count", () => {
    expect(createTaskMessageMetadata("2026-04-12T12:00:00.000Z", {
      reasoningContentCount: 2.7
    })).toEqual({
      message_time: "2026-04-12T12:00:00.000Z",
      reasoning_content_count: 2
    });
  });

  it("serializes a compact metadata line", () => {
    expect(buildTaskMessageMetadataLine(createTaskMessageMetadata("2026-04-12T12:00:00.000Z", {
      agentId: "default",
      reasoningContentCount: 0
    }))).toBe(
      "{\"metadata\":{\"message_time\":\"2026-04-12T12:00:00.000Z\",\"agent_id\":\"default\",\"reasoning_content_count\":0}}"
    );
  });

  it("appends metadata after message text", () => {
    expect(
      appendTaskMessageMetadataLine(
        "hello",
        createTaskMessageMetadata("2026-04-12T12:00:00.000Z")
      )
    ).toBe("hello\n{\"metadata\":{\"message_time\":\"2026-04-12T12:00:00.000Z\"}}");
  });
});
