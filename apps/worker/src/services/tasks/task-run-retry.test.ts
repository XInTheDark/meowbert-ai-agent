import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskStatus } from "@meowbert/shared";

vi.mock("../../lib/db.js", () => ({
  withTransaction: vi.fn()
}));

vi.mock("../../lib/queue.js", () => ({
  taskQueue: {
    add: vi.fn()
  }
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn()
}));

vi.mock("./task-run-dispatch.js", () => ({
  insertTaskRunDispatchWithClient: vi.fn()
}));

import { withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";
import { insertTaskRunDispatchWithClient } from "./task-run-dispatch.js";
import {
  buildTaskRunRetryNotice,
  planTaskRunRetry,
  scheduleTaskRunRetry
} from "./task-run-retry.js";

type MockQueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
  rowCount: number;
};

function buildRowsResult<Row extends Record<string, unknown>>(rows: Row[]): MockQueryResult<Row> {
  return {
    rows,
    rowCount: rows.length
  };
}

describe("planTaskRunRetry", () => {
  const hour = 60 * 60_000;
  const nowMs = Date.parse("2026-11-04T03:00:00Z");

  it("stops once the task has been failing for an hour, even with retries left", () => {
    expect(planTaskRunRetry({ retrySequenceNo: 2, maxRetries: 5, nowMs, failingSinceMs: nowMs - hour }).retrying).toBe(false);
    expect(planTaskRunRetry({ retrySequenceNo: 2, maxRetries: 5, nowMs, failingSinceMs: nowMs - hour / 2 }).retrying).toBe(true);
  });

  it("lets only Retry-After wait past the hour", () => {
    expect(planTaskRunRetry({
      retrySequenceNo: 2, maxRetries: 5, nowMs, failingSinceMs: nowMs - 2 * hour, retryAfterMs: 3 * hour
    })).toMatchObject({ retrying: true, delayMs: 3 * hour });
  });

  it("still counts Retry-After waits against the retry limit", () => {
    expect(planTaskRunRetry({ retrySequenceNo: 6, maxRetries: 5, retryAfterMs: 1_000 }).retrying).toBe(false);
  });

  it("does not let Retry-After pass a hard deadline", () => {
    expect(planTaskRunRetry({
      retrySequenceNo: 1, maxRetries: 5, nowMs, retryAfterMs: 2 * hour, hardDeadlineAtMs: nowMs + hour
    }).retrying).toBe(false);
  });

  it("keeps exponential backoff for early retries and caps long delays", () => {
    const fourthRetry = planTaskRunRetry({
      retrySequenceNo: 4,
      maxRetries: 5,
      policy: { baseDelayMs: 1_000, maxDelayMs: 8_000 }
    });
    const laterRetry = planTaskRunRetry({
      retrySequenceNo: 12,
      maxRetries: 12,
      policy: { baseDelayMs: 1_000, maxDelayMs: 8_000 }
    });

    expect(fourthRetry).toMatchObject({
      retrying: true,
      delayMs: 8_000,
      cappedDelayMs: 8_000
    });
    expect(laterRetry).toMatchObject({
      retrying: true,
      delayMs: 8_000,
      cappedDelayMs: 8_000
    });
  });

  it("stops after the configured number of retries", () => {
    const exhausted = planTaskRunRetry({
      retrySequenceNo: 6,
      maxRetries: 5,
      policy: { baseDelayMs: 1_000, maxDelayMs: 8_000 }
    });

    expect(exhausted).toMatchObject({
      retrying: false,
      delayMs: 0
    });
  });
});

describe("buildTaskRunRetryNotice", () => {
  it("formats immediate retries without a zero-second countdown", () => {
    expect(buildTaskRunRetryNotice({
      attemptNo: 7,
      errorMessage: "boom",
      delayMs: 0
    })).toBe("Task run failed (attempt 7): boom. Retrying now.");
  });
});

describe("scheduleTaskRunRetry", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedQueueAdd = vi.mocked(taskQueue.add);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);
  const mockedInsertTaskRunDispatchWithClient = vi.mocked(insertTaskRunDispatchWithClient);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQueueAdd.mockResolvedValue(undefined as never);
  });

  it("records the failed run as retrying, schedules the next run, and emits retry metadata", async () => {
    const retrySeriesStartedAt = new Date(Date.now() - 3_000).toISOString();
    const queryMock = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        task_id: "task-1",
        attempt_no: 3,
        run_kind: "default",
        ended_at: null,
        retry_series_started_at: retrySeriesStartedAt,
        retry_sequence_no: 4,
        max_task_run_retries: 5
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ status: "running" as TaskStatus }]))
      .mockResolvedValueOnce(buildRowsResult([{ attempt_no: 4 }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    mockedWithTransaction.mockImplementationOnce(async (callback) => callback({ query: queryMock } as never));

    const result = await scheduleTaskRunRetry({
      job: {
        taskId: "task-1",
        runId: "run-1",
        workspaceId: "workspace-1",
        environmentId: "environment-1",
        triggerSource: "web",
        mode: "default"
      },
      error: new Error("boom")
    });

    expect(result).toMatchObject({
      status: "scheduled",
      nextRunId: expect.any(String),
      nextAttemptNo: 4,
      retrySequenceNo: 5,
      delayMs: 40_000
    });
    expect(queryMock).toHaveBeenCalledTimes(7);
    expect(mockedQueueAdd).toHaveBeenCalledWith(
      expect.stringContaining("task-task-1-run-"),
      expect.objectContaining({
        taskId: "task-1",
        runId: expect.any(String)
      }),
      expect.objectContaining({
        attempts: 1,
        delay: 40_000,
        removeOnComplete: 200,
        removeOnFail: 200
      })
    );
    expect(mockedEmitTaskEvent).toHaveBeenNthCalledWith(1, "task-1", "status", { status: "queued" });
    expect(mockedEmitTaskEvent).toHaveBeenNthCalledWith(2, "task-1", "error", expect.objectContaining({
      retrying: true,
      delayMs: 40_000,
      nextAttemptNo: 4,
      retrySequenceNo: 5
    }));
  });

  it("preserves scheduler-managed retries as pending dispatch rows instead of enqueueing BullMQ directly", async () => {
    const retrySeriesStartedAt = new Date(Date.now() - 3_000).toISOString();
    const queryMock = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        task_id: "task-1",
        attempt_no: 3,
        run_kind: "default",
        ended_at: null,
        retry_series_started_at: retrySeriesStartedAt,
        retry_sequence_no: 4,
        max_task_run_retries: 5
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ status: "running" as TaskStatus }]))
      .mockResolvedValueOnce(buildRowsResult([{ attempt_no: 4 }]))
      .mockResolvedValueOnce(buildRowsResult([{
        dispatch_class: "interactive_followup",
        priority_actor_user_id: "user-1",
        priority_actor_is_super_admin: false
      }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    mockedWithTransaction.mockImplementationOnce(async (callback) => callback({ query: queryMock } as never));

    const result = await scheduleTaskRunRetry({
      job: {
        taskId: "task-1",
        runId: "run-1",
        workspaceId: "workspace-1",
        environmentId: "environment-1",
        triggerSource: "web",
        mode: "default"
      },
      error: new Error("boom")
    });

    expect(result).toMatchObject({
      status: "scheduled",
      schedulerManaged: true,
      nextAttemptNo: 4
    });
    if (result.status !== "scheduled") {
      throw new Error("Expected retry scheduling to succeed");
    }
    expect(mockedQueueAdd).not.toHaveBeenCalled();

    expect(mockedInsertTaskRunDispatchWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dispatchClass: "interactive_followup",
        payload: expect.objectContaining({
          taskId: "task-1",
          runId: result.nextRunId
        })
      })
    );
  });

  it("stops retrying once the configured retry limit is exhausted", async () => {
    const queryMock = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        task_id: "task-1",
        attempt_no: 2,
        run_kind: "default",
        ended_at: null,
        retry_series_started_at: "2026-03-09T00:00:00.000Z",
        retry_sequence_no: 6,
        max_task_run_retries: 5
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ status: "running" as TaskStatus }]));

    mockedWithTransaction.mockImplementationOnce(async (callback) => callback({ query: queryMock } as never));

    const result = await scheduleTaskRunRetry({
      job: {
        taskId: "task-1",
        runId: "run-1",
        workspaceId: "workspace-1",
        environmentId: "environment-1",
        triggerSource: "web",
        mode: "default"
      },
      error: new Error("boom")
    });

    expect(result).toEqual({
      status: "exhausted",
      errorMessage: "boom"
    });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
    expect(mockedEmitTaskEvent).not.toHaveBeenCalled();
  });

  it("skips retry scheduling for clearly non-retryable errors", async () => {
    const result = await scheduleTaskRunRetry({
      job: {
        taskId: "task-1",
        runId: "run-1",
        workspaceId: "workspace-1",
        environmentId: "environment-1",
        triggerSource: "web",
        mode: "default"
      },
      error: new Error("Skill not found: slides")
    });

    expect(result).toEqual({
      status: "non_retryable",
      errorMessage: "Skill not found: slides"
    });
    expect(mockedWithTransaction).not.toHaveBeenCalled();
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("does not retry a run whose attached Google Drive folder is gone", async () => {
    const errorMessage = "The attached Google Drive folder no longer exists or is not shared with the connected account. Remove it from the project and attach it again.";
    const result = await scheduleTaskRunRetry({
      job: {
        taskId: "task-1",
        runId: "run-1",
        workspaceId: "workspace-1",
        environmentId: "environment-1",
        triggerSource: "web",
        mode: "default"
      },
      error: new Error(errorMessage)
    });

    expect(result).toEqual({ status: "non_retryable", errorMessage });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("does not retry a timed run after its run time limit", async () => {
    const result = await scheduleTaskRunRetry({
      job: {
        taskId: "task-1",
        runId: "run-1",
        workspaceId: "workspace-1",
        environmentId: "environment-1",
        triggerSource: "web",
        mode: "infinite_auto"
      },
      error: new Error("RUN_TIME_LIMIT_REACHED")
    });

    expect(result).toEqual({
      status: "non_retryable",
      errorMessage: "RUN_TIME_LIMIT_REACHED"
    });
    expect(mockedWithTransaction).not.toHaveBeenCalled();
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  describe("retry clock", () => {
    const hour = 60 * 60_000;
    const jobInput = {
      taskId: "task-1", runId: "run-1", workspaceId: "workspace-1", environmentId: "environment-1",
      triggerSource: "web" as const, mode: "default" as const
    };

    function mockRun(overrides: Record<string, unknown>) {
      const queryMock = vi.fn().mockResolvedValue(buildRowsResult([]))
        .mockResolvedValueOnce(buildRowsResult([{
          task_id: "task-1", attempt_no: 1, run_kind: "default", ended_at: null,
          retry_sequence_no: 1, max_task_run_retries: 5, ...overrides
        }]))
        .mockResolvedValueOnce(buildRowsResult([{ status: "running" as TaskStatus }]))
        .mockResolvedValueOnce(buildRowsResult([{ attempt_no: 2 }]));
      vi.mocked(withTransaction).mockImplementationOnce(async (callback) => callback({ query: queryMock } as never));
    }

    it("gives a task that ran for hours a full window from its first failure", async () => {
      mockRun({ retry_series_started_at: new Date(Date.now() - 5 * hour).toISOString() });
      const result = await scheduleTaskRunRetry({ job: jobInput, error: new Error("boom") });
      expect(result.status).toBe("scheduled");
      if (result.status !== "scheduled") return;
      expect(Date.parse(result.payload.retryDeadlineAt!)).toBeGreaterThan(Date.now() + hour - 60_000);
    });

    it("stops a retried run that has been failing for over an hour", async () => {
      mockRun({ retry_sequence_no: 3, retry_series_started_at: new Date(Date.now() - 2 * hour).toISOString() });
      const result = await scheduleTaskRunRetry({ job: jobInput, error: new Error("boom") });
      expect(result.status).toBe("exhausted");
    });

    it("restarts the window when a retried run got a model response", async () => {
      mockRun({
        retry_sequence_no: 3,
        retry_series_started_at: new Date(Date.now() - 5 * hour).toISOString(),
        last_model_response_at: new Date(Date.now() - 60_000).toISOString()
      });
      const result = await scheduleTaskRunRetry({ job: jobInput, error: new Error("boom") });
      expect(result.status).toBe("scheduled");
    });

    it("schedules past the window for Retry-After, but not past an idle compaction deadline", async () => {
      const startedAt = new Date(Date.now() - 2 * hour).toISOString();
      const error = Object.assign(new Error("boom"), { retryAfterMs: hour });

      mockRun({ retry_sequence_no: 3, retry_series_started_at: startedAt });
      expect(await scheduleTaskRunRetry({ job: jobInput, error })).toMatchObject({ status: "scheduled", delayMs: hour });

      mockRun({ retry_sequence_no: 3, retry_series_started_at: startedAt });
      const idleJob = { ...jobInput, idleCompactionDeadlineAt: new Date(Date.now() + 60_000).toISOString() };
      expect(await scheduleTaskRunRetry({ job: idleJob, error })).toMatchObject({ status: "exhausted" });
    });
  });
});
