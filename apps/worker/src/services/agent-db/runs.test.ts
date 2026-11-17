import { beforeEach, expect, it, vi } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";
vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../../lib/queue.js", () => ({ taskQueue: { add: vi.fn() } }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));
vi.mock("../tasks/task-run-dispatch.js", () => ({ insertTaskRunDispatchWithClient: vi.fn(), markTaskRunDispatchFinished: vi.fn() }));
import { withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { insertTaskRunDispatchWithClient } from "../tasks/task-run-dispatch.js";
import { enqueueContinuationRun } from "./runs.js";
const job: TaskExecutionJob = { taskId: "task", runId: "old", workspaceId: "workspace", environmentId: "project",
  triggerSource: "web", toolOptionsOverride: { memorySearch: true } };
beforeEach(() => vi.resetAllMocks());

it.each(["host", "sandbox"] as const)("uses persisted %s device admission for an interrupted continuation", async (mode) => {
  const target = { kind: "local", deviceId: "persisted-device", mode };
  const query = vi.fn(async (sql: string) => ({ rowCount: 1, rows: sql.includes("FROM tasks")
    ? [{ id: "task", execution_target: target, initiator_user_id: "owner" }] : [{ attempt_no: 2 }] }));
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query } as never));
  const continuation = await enqueueContinuationRun({ ...job, executionTarget: { kind: "cloud" } },
    { branchMessageId: "latest", selectionUserId: "member", toolOptionsOverride: null });
  expect(continuation.attemptNo).toBe(2);
  expect(insertTaskRunDispatchWithClient).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({
    runId: continuation.runId, dispatchCategory: "followup", priorityActorUserId: "member",
    payload: expect.objectContaining({ executionTarget: target, branchMessageId: "latest", selectionUserId: "member", toolOptionsOverride: undefined })
  }));
  expect(taskQueue.add).not.toHaveBeenCalled();
});

it("keeps a cloud continuation in the existing queue with its tool overrides", async () => {
  const query = vi.fn(async (sql: string) => ({ rowCount: 1, rows: sql.includes("FROM tasks")
    ? [{ id: "task", execution_target: { kind: "cloud" } }] : [{ attempt_no: 3 }] }));
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query } as never));
  const result = await enqueueContinuationRun(job);
  expect(taskQueue.add).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ runId: result.runId,
    executionTarget: { kind: "cloud" }, toolOptionsOverride: job.toolOptionsOverride }), expect.anything());
  expect(insertTaskRunDispatchWithClient).not.toHaveBeenCalled();
});

it.each([
  { cancellation_requested: true, resume_after_interrupt: false, current_run_owns_task: true },
  { cancellation_requested: true, resume_after_interrupt: true, current_run_owns_task: false }
])("honors a later Stop or supersession under the interruption-allocation lock: %j", async (intent) => {
  const task = { id: "task", status: "running", ...intent };
  const query = vi.fn(async (sql: string) => {
    expect(sql).toContain("FOR UPDATE");
    return { rowCount: 1, rows: [task] };
  });
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query } as never));
  await expect(enqueueContinuationRun(job, { onlyIfInterrupted: true })).rejects.toThrow("TASK_CANCELLED");
  expect(query).toHaveBeenCalledTimes(1);
  expect(task).toEqual({ id: "task", status: "running", ...intent });
  expect(taskQueue.add).not.toHaveBeenCalled();
  expect(insertTaskRunDispatchWithClient).not.toHaveBeenCalled();
});

it("resumes a still-requested interruption after checking it under the task lock", async () => {
  const query = vi.fn(async (sql: string) => ({ rowCount: 1, rows: sql.includes("FROM tasks")
    ? [{ id: "task", cancellation_requested: true, resume_after_interrupt: true, current_run_owns_task: true }]
    : [{ attempt_no: 2 }] }));
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query } as never));
  const result = await enqueueContinuationRun(job, { onlyIfInterrupted: true });
  expect(result.attemptNo).toBe(2);
  expect(taskQueue.add).toHaveBeenCalledTimes(1);
});
