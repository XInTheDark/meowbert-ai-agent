import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./task-history-archive-activity.js", () => ({
  claimNextManualArchiveRun: vi.fn(),
  failArchiveRun: vi.fn()
}));

vi.mock("./task-history-archive-loop.js", () => ({
  runTaskHistoryArchivePass: vi.fn()
}));

import {
  claimNextManualArchiveRun,
  failArchiveRun
} from "./task-history-archive-activity.js";
import { runTaskHistoryArchivePass } from "./task-history-archive-loop.js";
import { processTaskHistoryArchiveRequestOnce } from "./task-history-archive-request-loop.js";

describe("processTaskHistoryArchiveRequestOnce", () => {
  const mockedClaim = vi.mocked(claimNextManualArchiveRun);
  const mockedFail = vi.mocked(failArchiveRun);
  const mockedRunPass = vi.mocked(runTaskHistoryArchivePass);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFail.mockResolvedValue(undefined);
  });

  it("returns false when no manual archive is queued", async () => {
    mockedClaim.mockResolvedValue(null);

    await expect(processTaskHistoryArchiveRequestOnce()).resolves.toBe(false);
    expect(mockedRunPass).not.toHaveBeenCalled();
  });

  it("processes a claimed manual archive through the normal archive pass", async () => {
    mockedClaim.mockResolvedValue("run-1");
    mockedRunPass.mockResolvedValue(1);

    await expect(processTaskHistoryArchiveRequestOnce()).resolves.toBe(true);
    expect(mockedRunPass).toHaveBeenCalledWith({
      activityRunId: "run-1",
      triggerSource: "manual"
    });
  });

  it("marks a claimed request failed when processing throws", async () => {
    const error = new Error("archive unavailable");
    mockedClaim.mockResolvedValue("run-1");
    mockedRunPass.mockRejectedValue(error);

    await expect(processTaskHistoryArchiveRequestOnce()).rejects.toThrow("archive unavailable");
    expect(mockedFail).toHaveBeenCalledWith("run-1", error);
  });
});
