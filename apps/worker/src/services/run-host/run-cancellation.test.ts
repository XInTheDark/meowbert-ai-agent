import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../agent-db/index.js", () => ({
  isResumeAfterInterruptRequested: vi.fn(),
  enqueueContinuationRun: vi.fn(),
  isTaskRunLatestAttempt: vi.fn(),
  isCancellationRequested: vi.fn(),
  recordRunCompletion: vi.fn().mockResolvedValue(undefined),
  resolveContinuationBranchMessageId: vi.fn(),
  resolveLatestBranchSelectionUserId: vi.fn(),
  setTaskStatusForRun: vi.fn()
}));

vi.mock("../task-schedules/service.js", () => ({
  resolveContinuationModeForInterruptedTask: vi.fn()
}));

import { emitTaskEvent } from "../runtime/events.js";
import { query } from "../../lib/db.js";
import {
  isResumeAfterInterruptRequested,
  enqueueContinuationRun,
  isTaskRunLatestAttempt,
  isCancellationRequested,
  recordRunCompletion,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { resolveContinuationModeForInterruptedTask } from "../task-schedules/service.js";
import { handleCancelledRun } from "./run-cancellation.js";

describe("settling cancelled runs", () => {
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);
  const mockedEnqueueContinuationRun = vi.mocked(enqueueContinuationRun);
  const mockedIsResumeAfterInterruptRequested = vi.mocked(isResumeAfterInterruptRequested);
  const mockedIsTaskRunLatestAttempt = vi.mocked(isTaskRunLatestAttempt);
  const mockedIsCancellationRequested = vi.mocked(isCancellationRequested);
  const mockedRecordRunCompletion = vi.mocked(recordRunCompletion);
  const mockedSetTaskStatusForRun = vi.mocked(setTaskStatusForRun);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSetTaskStatusForRun.mockResolvedValue(true);
    mockedIsResumeAfterInterruptRequested.mockResolvedValue(false);
    mockedIsTaskRunLatestAttempt.mockResolvedValue(true);
    mockedIsCancellationRequested.mockResolvedValue(false);
  });

  it("ignores stale cancelled runs once a newer attempt owns the task", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);
    mockedSetTaskStatusForRun.mockResolvedValue(false);

    await handleCancelledRun({
      taskId: "task-1",
      runId: "run-stale",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web",
      mode: "agent_swarm_leader"
    });

    expect(mockedSetTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-stale", "cancelled");
    expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-stale", "cancelled");
    expect(mockedIsResumeAfterInterruptRequested).not.toHaveBeenCalled();
    expect(mockedEmitTaskEvent).not.toHaveBeenCalled();
  });

  describe("interrupted runs that resume", () => {
    const job = {
      taskId: "task-1",
      runId: "run-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web" as const,
      mode: "default" as const
    };

    beforeEach(() => {
      mockedIsResumeAfterInterruptRequested.mockResolvedValue(true);
      mockedEnqueueContinuationRun.mockResolvedValue({ runId: "run-2", attemptNo: 2 });
      vi.mocked(resolveContinuationModeForInterruptedTask).mockResolvedValue("default");
    });

    it("never marks the task cancelled while it continues with the new message", async () => {
      await handleCancelledRun(job);

      expect(mockedEnqueueContinuationRun).toHaveBeenCalledTimes(1);
      expect(mockedEnqueueContinuationRun).toHaveBeenCalledWith(job, expect.objectContaining({ onlyIfInterrupted: true }));
      expect(mockedSetTaskStatusForRun).not.toHaveBeenCalled();
      expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-1", "cancelled");
    });

    it("settles a Stop arriving before continuation allocation without clearing its intent", async () => {
      mockedEnqueueContinuationRun.mockRejectedValueOnce(new Error("TASK_CANCELLED"));
      await handleCancelledRun(job);
      expect(mockedSetTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "cancelled");
      expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-1", "cancelled");
      expect(query).not.toHaveBeenCalled();
    });

    it("settles the task as cancelled when the continuation cannot be queued", async () => {
      mockedEnqueueContinuationRun.mockRejectedValue(new Error("queue down"));

      await handleCancelledRun(job);

      expect(mockedSetTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "cancelled");
      expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-1", "cancelled");
    });
  });
});
