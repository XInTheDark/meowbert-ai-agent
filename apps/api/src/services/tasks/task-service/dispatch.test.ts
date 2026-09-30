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

  it("reactivates completed agent swarm workflows before enqueuing the next leader run", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "agent_swarm",
        workflow_internal_role: "leader",
        workflow_parent_task_id: null,
        status: "succeeded"
      }]))
      .mockResolvedValueOnce(buildRowsResult([{
        phase: "completed",
        state_json: {
          workersStartedAt: "2026-03-18T00:00:00.000Z",
          leaderKickoffMessageNo: 14,
          finalReview: { approved: true },
          lastSwarmWaitCycleSignature: "old-cycle",
          lastSwarmWaitCycleTaskIds: ["worker-1", "worker-2", "worker-1"]
        }
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ latest_message_no: 29 }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    const mode = await resolveUserTriggeredRunModeInTx({ query } as never, "task-1");

    expect(mode).toBe("agent_swarm_leader");
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT t.workflow_type"),
      ["task-1"]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("SELECT phase, state_json"),
      ["task-1"]
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("SELECT COALESCE(MAX(message_no), 0)::int AS latest_message_no"),
      ["task-1"]
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("SET phase = 'active'"),
      [
        "task-1",
        JSON.stringify({
          workersStartedAt: null,
          leaderKickoffMessageNo: null,
          finalReview: null,
          cycleStartMessageNo: 29,
          startedSwarmWorkerTaskIds: [],
          reviewRounds: [],
          pausedSwarmAgents: {}
        })
      ]
    );
    expect(query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("UPDATE task_runs tr"),
      ["task-1"]
    );
    expect(query).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining("SET status = 'awaiting_input'"),
      ["task-1"]
    );
  });

  it("reactivates completed agent swarm workflows even if a stale queued status remains", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "agent_swarm",
        workflow_internal_role: "leader",
        workflow_parent_task_id: null,
        status: "queued"
      }]))
      .mockResolvedValueOnce(buildRowsResult([{
        phase: "completed",
        state_json: {
          workersStartedAt: "2026-03-18T00:00:00.000Z",
          leaderKickoffMessageNo: 14
        }
      }]))
      .mockResolvedValueOnce(buildRowsResult([{ latest_message_no: 31 }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    const mode = await resolveUserTriggeredRunModeInTx({ query } as never, "task-2");

    expect(mode).toBe("agent_swarm_leader");
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("SET phase = 'active'"),
      [
        "task-2",
        JSON.stringify({
          workersStartedAt: null,
          leaderKickoffMessageNo: null,
          cycleStartMessageNo: 31,
          startedSwarmWorkerTaskIds: [],
          reviewRounds: [],
          finalReview: null,
          pausedSwarmAgents: {}
        })
      ]
    );
  });
});
