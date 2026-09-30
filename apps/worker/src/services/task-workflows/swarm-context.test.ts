import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { buildSwarmContext } from "./swarm-context.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("buildSwarmContext", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it("tracks started nested swarms awaiting output", async () => {
    const mockedQuery = vi.mocked(query);
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([{ latest_message_no: 1 }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "global-channel" }]))
      .mockResolvedValueOnce(buildRowsResult([]));
    const agents = [
      { id: "root-agent", role: "leader" as const, slot_index: 0, task_id: "root-task",
        title: "Root", status: "running", task_root_path: "/root", last_inbox_refresh_message_no: 0,
        state_json: { swarmLeafId: "root-leaf" } },
      { id: "nested-agent", role: "worker" as const, slot_index: 0, task_id: "nested-task",
        title: "Nested", status: "running", task_root_path: "/nested", last_inbox_refresh_message_no: 0,
        state_json: { swarmLeafId: "nested-leaf", swarmParentNodeId: "inner-node" } }
    ];
    const swarm = await buildSwarmContext({
      workflowTaskId: "root-task", taskId: "root-task", envRoot: "/tmp",
      currentAgentId: "root-agent", agents,
      configJson: { compiledSwarm: {
        rootNodeId: "outer-node",
        nodes: [
          { id: "outer-node", parentNodeId: null, leaderLeafId: "root-leaf", workerLeafIds: ["nested-leaf"] },
          { id: "inner-node", parentNodeId: "outer-node", leaderLeafId: "nested-leaf", workerLeafIds: [] }
        ]
      } },
      stateJson: { startedSwarmWorkerTaskIds: ["nested-task"], completedSwarmNodeIds: {} }
    });
    expect(swarm?.pendingNestedSwarmNodeIds).toEqual(["inner-node"]);
    expect(swarm?.missingWorkerGlobalReportTaskIds).toEqual(["nested-task"]);
  });

  it("requires fresh worker global reports after a swarm cycle is reactivated", async () => {
    const mockedQuery = vi.mocked(query);
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([{ latest_message_no: 29 }]))
      .mockResolvedValueOnce(buildRowsResult([
        {
          sender_task_id: "leader-task",
          sender_role: "leader",
          global_message_count_since_cycle_start: 1,
          global_message_count_since_leader_kickoff: 0
        },
        {
          sender_task_id: "worker-task-1",
          sender_role: "worker",
          global_message_count_since_cycle_start: 3,
          global_message_count_since_leader_kickoff: 0
        }
      ]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "global-channel" }]))
      .mockResolvedValueOnce(buildRowsResult([
        {
          id: "global-channel",
          kind: "global",
          title: "Global",
          created_at: "2026-03-18T00:00:00.000Z",
          latest_message_no: 29,
          unread_count: 0,
          member_task_ids: ["leader-task", "worker-task-1"]
        }
      ]));

    const swarm = await buildSwarmContext({
      workflowTaskId: "workflow-1",
      taskId: "leader-task",
      envRoot: "/tmp",
      currentAgentId: "leader-agent",
      configJson: { compiledSwarm: { rootNodeId: "root-node" } },
      agents: [
        {
          id: "leader-agent",
          role: "leader",
          slot_index: 0,
          task_id: "leader-task",
          title: "Leader",
          status: "queued",
          task_root_path: ".meowbert/task-runs/leader-task",
          last_inbox_refresh_message_no: 0
        },
        {
          id: "worker-agent-1",
          role: "worker",
          slot_index: 0,
          task_id: "worker-task-1",
          title: "Worker 1",
          status: "awaiting_input",
          task_root_path: ".meowbert/task-runs/worker-task-1",
          last_inbox_refresh_message_no: 0,
          state_json: { swarmParentNodeId: "root-node" }
        },
        {
          id: "worker-agent-2",
          role: "worker",
          slot_index: 1,
          task_id: "worker-task-2",
          title: "Nested worker",
          status: "awaiting_input",
          task_root_path: ".meowbert/task-runs/worker-task-2",
          last_inbox_refresh_message_no: 0,
          state_json: { swarmParentNodeId: "nested-node" }
        }
      ],
      stateJson: {
        cycleStartMessageNo: 20,
        leaderKickoffMessageNo: 29,
        workersStartedAt: "2026-03-18T00:00:00.000Z",
        startedSwarmWorkerTaskIds: ["worker-task-1", "worker-task-2"]
      }
    });

    expect(mockedQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("global_message_count_since_leader_kickoff"),
      ["workflow-1", 20, 29]
    );
    expect(swarm?.leaderGlobalMessageCount).toBe(1);
    expect(swarm?.workerGlobalReportTaskIds).toEqual([]);
    expect(swarm?.missingWorkerGlobalReportTaskIds).toEqual(["worker-task-1"]);
    expect(swarm?.missingWorkerGlobalReportLabels).toEqual(["Worker 1"]);
  });
});
