import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import {
  claimNextManualArchiveRun,
  completeArchiveRun
} from "./task-history-archive-activity.js";

describe("task history archive activity", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("claims the oldest queued manual request with skip-locked semantics", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: "run-1" }], rowCount: 1 } as never);

    await expect(claimNextManualArchiveRun()).resolves.toBe("run-1");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("SET status = 'running'");
  });

  it("persists archive sizes and content counts on completion", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    await completeArchiveRun("run-1", {
      status: "archived",
      archiveKey: "v1/task.json.gz",
      metrics: {
        originalSizeBytes: 1000,
        compressedSizeBytes: 250,
        messageCount: 4,
        eventCount: 20,
        revisionCount: 1,
        workflowMessageCount: 2
      }
    });

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("compressed_size_bytes = $5"),
      ["run-1", "completed", "v1/task.json.gz", 1000, 250, 4, 20, 1, 2, null]
    );
  });

  it("persists the reason when an archive is skipped", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    await completeArchiveRun("run-1", {
      status: "skipped",
      reason: "Task became active while its archive was being written."
    });

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("error_summary = $10"),
      [
        "run-1",
        "skipped",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "Task became active while its archive was being written."
      ]
    );
  });
});
