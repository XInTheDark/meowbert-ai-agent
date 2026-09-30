import { describe, expect, it, vi } from "vitest";
import type { TaskMessageRow } from "../agent/types.js";

vi.mock("../../lib/config.js", () => ({ config: {} }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));

import { getMessagesAfterLatestCompaction, getMessagesForV2ActiveWindow, getVisibleMessagesForContextClear } from "./history.js";

function message(id: string, role: TaskMessageRow["role"], content: Record<string, unknown>): TaskMessageRow {
  return {
    id,
    role,
    content_json: content,
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-08-01T00:00:00.000Z"
  };
}

describe("getMessagesAfterLatestCompaction", () => {
  it("uses a context checkpoint as the latest persisted context boundary", () => {
    const checkpoint = message("checkpoint", "system", {
      kind: "context_checkpoint",
      checkpoint: "Continue here.",
      response_items: [{ role: "user", content: "retained" }]
    });
    const later = message("later", "user", { text: "Next request" });

    expect(getMessagesAfterLatestCompaction([
      message("old", "user", { text: "Trimmed history" }),
      message("compaction", "system", { kind: "context_compaction" }),
      checkpoint,
      later
    ])).toEqual([checkpoint, later]);
  });
});

describe("getVisibleMessagesForContextClear", () => {
  it("retains messages displayed before and after compaction while excluding context markers", () => {
    const before = message("before", "user", { text: "First request" });
    const after = message("after", "user", { text: "Follow-up" });

    expect(getVisibleMessagesForContextClear([
      before,
      message("compaction", "system", { kind: "context_compaction" }),
      message("checkpoint", "system", { kind: "context_checkpoint" }),
      after
    ])).toEqual([before, after]);
  });
});

describe("getMessagesForV2ActiveWindow", () => {
  it("seeds only messages after the latest window checkpoint", () => {
    const recent = message("recent", "user", { text: "Continue" });

    expect(getMessagesForV2ActiveWindow([
      message("old", "user", { text: "Earlier request" }),
      message("checkpoint", "system", { kind: "context_checkpoint" }),
      recent
    ])).toEqual([recent]);
  });
});

describe("context recovery replay", () => {
  it("replays the reconstructed payload once from its recovery boundary", () => {
    const recovery = message("recovery", "system", {
      kind: "context_recovery",
      text: "Context repaired",
      response_items: [{ role: "user", content: "Rebuilt request" }]
    });
    const followUp = message("follow-up", "user", { text: "Continue" });

    expect(getMessagesAfterLatestCompaction([
      message("old", "user", { text: "Original request" }),
      recovery,
      followUp
    ])).toEqual([recovery, followUp]);
    expect(getVisibleMessagesForContextClear([
      message("old", "user", { text: "Original request" }),
      recovery,
      followUp
    ])).toEqual([
      message("old", "user", { text: "Original request" }),
      followUp
    ]);
  });
});
