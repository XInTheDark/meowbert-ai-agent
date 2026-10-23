import { describe, expect, it, vi } from "vitest";
import { resolveUserTriggeredRunModeInTx } from "./dispatch.js";

function buildRowsResult<Row extends object>(rows: Row[]) {
  return {
    rows,
    rowCount: rows.length
  };
}

describe("resolveUserTriggeredRunModeInTx", () => {
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
