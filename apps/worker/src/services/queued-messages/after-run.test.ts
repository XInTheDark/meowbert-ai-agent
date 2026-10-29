import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  query: vi.fn(),
  enqueueContinuationRun: vi.fn(),
  emitTaskEvent: vi.fn()
}));

vi.mock("../../lib/db.js", () => ({
  query: mocks.query,
  withTransaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run({ query: mocks.clientQuery }))
}));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: mocks.emitTaskEvent }));
vi.mock("../agent-db/index.js", () => ({
  enqueueContinuationRun: mocks.enqueueContinuationRun,
  resolveContinuationBranchMessageId: vi.fn(async () => "leaf-1"),
  resolveLatestBranchSelectionUserId: vi.fn(async () => "user-1")
}));
vi.mock("../task-schedules/service.js", () => ({
  resolveContinuationModeForInterruptedTask: vi.fn(async (_taskId: string, mode: string) => mode)
}));

import { startRunForQueuedMessages } from "./after-run.js";

const job = { taskId: "task-1", runId: "run-1", workspaceId: "w-1", environmentId: "e-1", triggerSource: "web", mode: "default" } as TaskExecutionJob;

function rows<Row extends object>(list: Row[]) {
  return { rows: list, rowCount: list.length };
}

function respondTo(status: string, queued: Array<Record<string, unknown>>) {
  mocks.clientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT status FROM tasks")) return rows([{ status }]);
    if (sql.includes("DELETE FROM task_queued_messages")) return rows(queued);
    return rows([]);
  });
}

describe("startRunForQueuedMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueContinuationRun.mockResolvedValue({ runId: "run-2", attemptNo: 2 });
  });

  it("appends what was queued after the last turn and starts the next run from it", async () => {
    respondTo("succeeded", [
      { author_user_id: "user-1", content_json: { text: "first" } },
      { author_user_id: "user-1", content_json: { text: "second" } }
    ]);

    await startRunForQueuedMessages(job);

    const inserts = mocks.clientQuery.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO task_messages"));
    expect(inserts.map(([, params]) => JSON.parse(params[2]).text)).toEqual(["first", "second"]);
    expect(inserts[0][1][3]).toBe("leaf-1");
    expect(inserts[1][1][3]).toBe(inserts[0][1][0]);
    expect(mocks.enqueueContinuationRun).toHaveBeenCalledWith(job, expect.objectContaining({
      branchMessageId: inserts[1][1][0],
      selectionUserId: "user-1",
      mode: "default"
    }));
  });

  it.each(["queued", "running", "cancelled"])("leaves the queue alone when the task is %s", async (status) => {
    respondTo(status, [{ author_user_id: "user-1", content_json: { text: "later" } }]);

    await startRunForQueuedMessages(job);

    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM task_queued_messages"))).toBe(false);
    expect(mocks.enqueueContinuationRun).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is queued", async () => {
    respondTo("succeeded", []);

    await startRunForQueuedMessages(job);

    expect(mocks.enqueueContinuationRun).not.toHaveBeenCalled();
  });

  it("restores the settled status when the next run cannot be created", async () => {
    respondTo("failed", [{ author_user_id: "user-1", content_json: { text: "retry" } }]);
    mocks.enqueueContinuationRun.mockRejectedValueOnce(new Error("queue down"));

    await startRunForQueuedMessages(job);

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("SET status = $2"), ["task-1", "failed"]);
    expect(mocks.emitTaskEvent).toHaveBeenCalledWith("task-1", "error", expect.anything());
  });
});
