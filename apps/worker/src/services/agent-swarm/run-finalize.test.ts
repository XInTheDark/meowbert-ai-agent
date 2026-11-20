import { beforeEach, expect, it, vi } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";
vi.mock("../../lib/db.js", () => ({ pool: { query: vi.fn() }, withTransaction: vi.fn() }));
vi.mock("./barrier.js", () => ({ wakeParentIfBarrierMetInTx: vi.fn() }));
vi.mock("./lane-completion.js", () => ({ finishLaneRun: vi.fn() }));
vi.mock("./lane-store.js", () => ({ dropDiscardedResultInTx: vi.fn(), loadLane: vi.fn(), setLaneStatusInTx: vi.fn() }));
vi.mock("./scheduler.js", () => ({ lockSwarmInTx: vi.fn(), startQueuedLanesInTx: vi.fn() }));
import { pool, withTransaction } from "../../lib/db.js";
import { dropDiscardedResultInTx, loadLane, setLaneStatusInTx } from "./lane-store.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { finishFailedLaneRun } from "./run-finalize.js";

beforeEach(() => vi.clearAllMocks());

it.each(["queued", "running", "cancelled"])("cancellation finalization preserves a resumed lane in %s state", async (status) => {
  vi.mocked(loadLane).mockResolvedValue({ task_id: "lane", parent_task_id: "parent", swarm_task_id: "swarm", status: "running" } as never);
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ config_json: {} }] } as never);
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "parent" }] }).mockResolvedValueOnce({ rows: [{ status }] });
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query } as never));
  await finishFailedLaneRun({ taskId: "lane", runId: "old-run", mode: "agent_swarm_lane" } as TaskExecutionJob, "cancelled", true);
  if (status === "cancelled") {
    expect(setLaneStatusInTx).toHaveBeenCalledWith(expect.anything(), "lane", "stopped", expect.anything());
    expect(dropDiscardedResultInTx).toHaveBeenCalledOnce();
    expect(wakeParentIfBarrierMetInTx).toHaveBeenCalledWith(expect.anything(), "parent");
  } else {
    expect(setLaneStatusInTx).not.toHaveBeenCalled();
    expect(dropDiscardedResultInTx).not.toHaveBeenCalled();
    expect(wakeParentIfBarrierMetInTx).not.toHaveBeenCalled();
  }
});
