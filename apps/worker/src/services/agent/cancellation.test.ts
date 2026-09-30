import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../agent-db/index.js", () => ({
  consumeResumeAfterInterrupt: vi.fn(),
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
import {
  consumeResumeAfterInterrupt,
  enqueueContinuationRun,
  isTaskRunLatestAttempt,
  isCancellationRequested,
  recordRunCompletion,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { resolveContinuationModeForInterruptedTask } from "../task-schedules/service.js";
import { handleCancelledRun, startTaskCancellationMonitor } from "./cancellation.js";

describe("task cancellation handling", () => {
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);
  const mockedEnqueueContinuationRun = vi.mocked(enqueueContinuationRun);
  const mockedConsumeResumeAfterInterrupt = vi.mocked(consumeResumeAfterInterrupt);
  const mockedIsTaskRunLatestAttempt = vi.mocked(isTaskRunLatestAttempt);
  const mockedIsCancellationRequested = vi.mocked(isCancellationRequested);
  const mockedRecordRunCompletion = vi.mocked(recordRunCompletion);
  const mockedSetTaskStatusForRun = vi.mocked(setTaskStatusForRun);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSetTaskStatusForRun.mockResolvedValue(true);
    mockedConsumeResumeAfterInterrupt.mockResolvedValue(false);
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
    expect(mockedConsumeResumeAfterInterrupt).not.toHaveBeenCalled();
    expect(mockedEmitTaskEvent).not.toHaveBeenCalled();
  });

  it("treats a superseded run as cancelled during cancellation checks", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);

    const monitor = startTaskCancellationMonitor("task-1", "run-old");
    await expect(monitor.assertNotCancelled()).rejects.toThrow("TASK_CANCELLED");
    monitor.stop();
  });

  it("can ignore a newer-attempt supersession when finalization explicitly allows it", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);

    const monitor = startTaskCancellationMonitor("task-1", "run-old");
    await expect(monitor.assertNotCancelled({ allowNewerAttempt: true })).resolves.toBeUndefined();
    monitor.stop();
  });

  it("still rejects explicit task cancellation even when newer attempts are allowed", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);
    mockedIsCancellationRequested.mockResolvedValue(true);

    const monitor = startTaskCancellationMonitor("task-1", "run-old");
    await expect(monitor.assertNotCancelled({ allowNewerAttempt: true })).rejects.toThrow("TASK_CANCELLED");
    monitor.stop();
  });

  it("treats an expired task time limit as cancelled during cancellation checks", async () => {
    const monitor = startTaskCancellationMonitor("task-1", "run-old", {
      timeLimitDeadlineAt: new Date(Date.now() - 1_000).toISOString()
    });

    await expect(monitor.assertNotCancelled()).rejects.toThrow("TASK_CANCELLED");
    monitor.stop();
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
      mockedConsumeResumeAfterInterrupt.mockResolvedValue(true);
      mockedEnqueueContinuationRun.mockResolvedValue({ runId: "run-2", attemptNo: 2 });
      vi.mocked(resolveContinuationModeForInterruptedTask).mockResolvedValue("default");
    });

    it("never marks the task cancelled while it continues with the new message", async () => {
      await handleCancelledRun(job);

      expect(mockedEnqueueContinuationRun).toHaveBeenCalledTimes(1);
      expect(mockedSetTaskStatusForRun).not.toHaveBeenCalled();
      expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-1", "cancelled");
    });

    it("settles the task as cancelled when the continuation cannot be queued", async () => {
      mockedEnqueueContinuationRun.mockRejectedValue(new Error("queue down"));

      await handleCancelledRun(job);

      expect(mockedSetTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "cancelled");
      expect(mockedRecordRunCompletion).toHaveBeenCalledWith("run-1", "cancelled");
    });
  });
});
