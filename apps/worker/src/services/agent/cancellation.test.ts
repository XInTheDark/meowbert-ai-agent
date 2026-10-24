import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  withTransaction: vi.fn(),
  withConnection: vi.fn(),
  pool: {}
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
import { startTaskCancellationMonitor } from "@meowbert/run-executor/agent/cancellation";
import { createTestRunControl } from "../run-host/test-run-environment.test-fixtures.js";

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

  it("treats a superseded run as cancelled during cancellation checks", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);

    const monitor = startTaskCancellationMonitor(createTestRunControl({ runId: "run-old" }));
    await expect(monitor.assertNotCancelled()).rejects.toThrow("TASK_CANCELLED");
    monitor.stop();
  });

  it("can ignore a newer-attempt supersession when finalization explicitly allows it", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);

    const monitor = startTaskCancellationMonitor(createTestRunControl({ runId: "run-old" }));
    await expect(monitor.assertNotCancelled({ allowNewerAttempt: true })).resolves.toBeUndefined();
    monitor.stop();
  });

  it("still rejects explicit task cancellation even when newer attempts are allowed", async () => {
    mockedIsTaskRunLatestAttempt.mockResolvedValue(false);
    mockedIsCancellationRequested.mockResolvedValue(true);

    const monitor = startTaskCancellationMonitor(createTestRunControl({ runId: "run-old" }));
    await expect(monitor.assertNotCancelled({ allowNewerAttempt: true })).rejects.toThrow("TASK_CANCELLED");
    monitor.stop();
  });

  it("treats an expired task time limit as cancelled during cancellation checks", async () => {
    const monitor = startTaskCancellationMonitor(createTestRunControl({ runId: "run-old" }), {
      timeLimitDeadlineAt: new Date(Date.now() - 1_000).toISOString()
    });

    await expect(monitor.assertNotCancelled()).rejects.toThrow("TASK_CANCELLED");
    monitor.stop();
  });
});
