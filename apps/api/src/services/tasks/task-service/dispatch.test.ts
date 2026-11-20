import { describe, expect, it, vi } from "vitest";
import { decideTaskDispatchModeInTx, resolveUserTriggeredRunModeInTx } from "./dispatch.js";

function buildRowsResult<Row extends object>(rows: Row[]) {
  return {
    rows,
    rowCount: rows.length
  };
}

describe("resolveUserTriggeredRunModeInTx", () => {
  it("expedites a delayed dispatch when a queued run is interrupted", async () => {
    let eligibleAt = new Date("2099-01-01T00:00:00Z");
    let cancelled = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT status")) return buildRowsResult([{ status: "queued" }]);
      if (sql.includes("FROM task_runs")) return buildRowsResult([{ id: "run-1" }]);
      if (sql.includes("cancellation_requested = true")) cancelled = true;
      if (sql.includes("eligible_at = LEAST")) eligibleAt = new Date();
      return buildRowsResult([]);
    });
    expect(await decideTaskDispatchModeInTx({ query } as never, "task-1", { interruptQueued: true })).toBe("interrupting");
    expect(cancelled).toBe(true);
    expect(eligibleAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it("uses the dedicated mode for a Quality control reviewer", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "long_horizon",
        workflow_internal_role: "reviewer",
        workflow_parent_task_id: "workflow-1",
        status: "queued"
      }]))
      .mockResolvedValueOnce(buildRowsResult([{
        phase: "reviewing",
        state_json: {},
        config_json: { reviewMode: "quality_control" }
      }]));

    await expect(resolveUserTriggeredRunModeInTx({ query } as never, "reviewer-1"))
      .resolves.toBe("quality_control_reviewer");
  });

  it("continues a swarm through its leader", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "agent_swarm", workflow_internal_role: null, workflow_parent_task_id: null, status: "succeeded"
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ legacy: false }]));

    await expect(resolveUserTriggeredRunModeInTx({ query } as never, "task-1")).resolves.toBe("agent_swarm_leader");
  });

  it("rejects follow-ups on a swarm from the previous version", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "agent_swarm", workflow_internal_role: null, workflow_parent_task_id: null, status: "succeeded"
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ legacy: true }]));

    await expect(resolveUserTriggeredRunModeInTx({ query } as never, "task-1"))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("previous swarm version") });
  });

  it("does not let a user message a lane directly", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "agent_swarm", workflow_internal_role: "lane", workflow_parent_task_id: "task-1", status: "succeeded"
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ legacy: false }]));

    await expect(resolveUserTriggeredRunModeInTx({ query } as never, "lane-1")).rejects.toMatchObject({ statusCode: 409 });
  });
});
