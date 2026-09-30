import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../../lib/queue.js", () => ({ taskQueue: { getJob: vi.fn(), add: vi.fn() } }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../agent-db/index.js", () => ({
  resolveContinuationBranchMessageId: vi.fn().mockResolvedValue(null),
  resolveLatestBranchSelectionUserId: vi.fn().mockResolvedValue(null)
}));
vi.mock("./task-run-dispatch.js", () => ({ markTaskRunDispatchPending: vi.fn().mockResolvedValue(undefined) }));
import { emitTaskEvent } from "../runtime/events.js";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { recoverQueuedTaskRunsOnce, recoverRunningTaskRunsOnce, startTaskRunRecoveryLoop } from "./task-run-recovery.js";

const row = (id: string) => ({ task_id: id, run_id: `run-${id}`, run_kind: "default", workspace_id: "w", environment_id: "e", source: "web", dispatch_queue_state: null });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(emitTaskEvent).mockResolvedValue(undefined); });

it("resumes old interrupted runs even if their queue timestamp predates the restart", async () => {
  vi.useFakeTimers();
  let status = "running";
  const old = { ...row("t"), started_at: "2020-01-01T00:00:00Z" };
  const tx = { query: vi.fn(async (sql: string) => {
    if (sql.includes("SELECT status")) return { rows: [{ status }], rowCount: 1 };
    if (sql.includes("SELECT id")) return { rows: [{ id: old.run_id }], rowCount: 1 };
    if (sql.includes("UPDATE tasks")) status = "queued";
    return { rows: [], rowCount: 1 };
  }) };
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn(tx as never));
  vi.mocked(query).mockImplementation(async () => ({ rows: [old], rowCount: 1 }) as never);
  vi.mocked(taskQueue.getJob).mockResolvedValue(undefined);
  const loop = startTaskRunRecoveryLoop();
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toBe("queued");
    expect(taskQueue.add).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({runId: old.run_id}), expect.any(Object));
    expect(tx.query.mock.calls.some(([sql]) => sql.includes("status = 'cancelled'"))).toBe(false);
  } finally { await loop.stop(); vi.useRealTimers(); }
});

it.each([recoverQueuedTaskRunsOnce, recoverRunningTaskRunsOnce])("advances past 100 healthy rows and wraps after the final batch", async (recover) => {
  const first = Array.from({length:100}, (_, i) => row(String(i).padStart(3, "0")));
  const later = row("100");
  vi.mocked(query)
    .mockResolvedValueOnce({rows:first} as never)
    .mockResolvedValueOnce({rows:[later]} as never)
    .mockResolvedValueOnce({rows:[]} as never);
  vi.mocked(taskQueue.getJob).mockResolvedValue({getState: async () => "waiting"} as never);
  await recover();
  await recover();
  expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining("t.id > $2::uuid"), [100, "099"]);
  await recover();
  expect(query).toHaveBeenNthCalledWith(3, expect.any(String), [100, null]);
});
