import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));
vi.mock("./shared.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./shared.js")>(),
  enqueueWorkflowTaskRun: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { enqueueWorkflowTaskRun } from "./shared.js";
import {
  getSwarmBudgetStatus,
  reserveSwarmInference,
  settleSwarmInference,
  wakeParentForSwarmQuota
} from "./agent-swarm-budget.js";

const context = {
  workflowTaskId: "workflow-1",
  workflowType: "agent_swarm",
  phase: "active",
  config: { tokenBudget: 100_000 },
  taskId: "leader-task",
  taskDir: "/tmp/task",
  workspaceId: "workspace-1",
  environmentId: "environment-1",
  currentAgent: {
    id: "agent-1", role: "leader", slot_index: 0, task_id: "leader-task", title: "Leader", status: "running",
    task_root_path: "/tmp/task", last_inbox_refresh_message_no: 0, state_json: {}
  },
  agents: [],
  planContent: null,
  runtime: { lastPassiveRefreshAtMs: 0, lastExplicitRefreshWorkflowMessageNo: 0, pendingChannelMessageSendAfterRefresh: false }
} satisfies LoadedWorkflowRunContext;

describe("Agent Swarm quota enforcement", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = { query: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  it("uses a leader-only reserve when the operating lease and pool are exhausted", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{
        node_id: "node-1", workflow_agent_id: "agent-1", role: "leader", lease_tokens: 8_192,
        member_spent_tokens: 8_192, member_reserved_tokens: 0, member_status: "active",
        allocated_tokens: 100_000, spent_tokens: 8_192, reserved_tokens: 0,
        system_reserve_tokens: 10_000, unassigned_tokens: 0, debt_tokens: 0,
        status: "active", deadline_at: null, node_leader_task_id: "leader-task", parent_leader_task_id: null
      }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    client.query
      .mockResolvedValueOnce({ rows: [{ status: "active", deadline_at: null, system_reserve_tokens: 10_000, unassigned_tokens: 0 }] })
      .mockResolvedValueOnce({ rows: [{ status: "active", lease_tokens: 8_192, spent_tokens: 8_192, reserved_tokens: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: "reservation-1" }] });

    const reservation = await reserveSwarmInference(context, false, "run-1");

    expect(reservation).toMatchObject({ recovery: true, runId: "run-1", requestedTokens: 8_192 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("system_reserve_tokens - $2"),
      ["node-1", 8_192, true]
    );
  });

  it("quarantines a response received after the deadline before tool dispatch", async () => {
    client.query.mockResolvedValueOnce({ rows: [{
      requested_tokens: 8_192, recovery: false, status: "active", quota_generation: 0,
      node_generation: 0, node_status: "active", deadline_at: "2020-01-01T00:00:00.000Z"
    }] });

    const accepted = await settleSwarmInference(context, {
      reservationId: "reservation-1", requestedTokens: 8_192, nodeId: "node-1",
      workflowAgentId: "agent-1", recovery: false, runId: "run-1"
    }, 7_000);

    expect(accepted).toBe(false);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'paused'"), ["node-1"]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'expired'"), ["reservation-1", 7_000]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("spent_tokens = spent_tokens +"))).toBe(false);
  });

  it("persists a deadline pause even when the locked reservation transaction rolls back", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{
      node_id: "node-1", workflow_agent_id: "agent-1", role: "leader", lease_tokens: 30_000,
      member_spent_tokens: 0, member_reserved_tokens: 0, member_status: "active",
      allocated_tokens: 100_000, spent_tokens: 0, reserved_tokens: 0,
      system_reserve_tokens: 16_384, unassigned_tokens: 20_000, debt_tokens: 0,
      status: "active", deadline_at: null, node_leader_task_id: "leader-task", parent_leader_task_id: null
    }], rowCount: 1 } as never);
    client.query.mockResolvedValueOnce({ rows: [{ status: "active", deadline_at: "2020-01-01T00:00:00.000Z",
      system_reserve_tokens: 16_384, unassigned_tokens: 20_000 }] });

    await expect(reserveSwarmInference(context, false, "run-1")).rejects.toMatchObject({ reason: "deadline_reached" });
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("paused_reason = $2"), ["node-1", "deadline_reached"]);
  });

  it("returns unused protected tokens after a recovery inference", async () => {
    client.query.mockResolvedValueOnce({ rows: [{
      requested_tokens: 8_192, recovery: true, status: "active", quota_generation: 0,
      node_generation: 0, node_status: "active", deadline_at: null
    }] });

    const accepted = await settleSwarmInference(context, {
      reservationId: "reservation-1", requestedTokens: 8_192, nodeId: "node-1",
      workflowAgentId: "agent-1", recovery: true, runId: "run-1"
    }, 5_000);

    expect(accepted).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("system_reserve_tokens + GREATEST(0, $2 - $3)"),
      ["node-1", 8_192, 5_000, 0, true]
    );
  });

  it("shows the unassigned pool and direct child usage for the selected node", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM task_workflow_swarm_nodes") && sql.includes("node_key = $1")) {
        return { rows: [{ id: "node-uuid", title: "Root", status: "active", allocated_tokens: 100_000,
          spent_tokens: 20_000, reserved_tokens: 0, system_reserve_tokens: 10_000,
          unassigned_tokens: 30_000, debt_tokens: 0, deadline_at: null }], rowCount: 1 } as never;
      }
      if (sql.includes("JOIN task_workflow_agents agent") && sql.includes("member.role = 'worker'")) {
        return { rows: [{ task_id: "worker-task", status: "active", lease_tokens: 12_000,
          spent_tokens: 5_000, reserved_tokens: 1_000 }], rowCount: 1 } as never;
      }
      if (sql.includes("FROM task_workflow_swarm_nodes") && sql.includes("parent_node_id = $1")) {
        return { rows: [{ id: "child-uuid", title: "Research", status: "active", allocated_tokens: 20_000,
          spent_tokens: 5_000, reserved_tokens: 0, system_reserve_tokens: 2_000,
          unassigned_tokens: 6_000, debt_tokens: 0, deadline_at: null,
          worker_slots: 1, lease_remaining_tokens: 7_000 }], rowCount: 1 } as never;
      }
      if (sql.includes("remaining_tokens") && sql.includes("FROM task_workflow_swarm_node_members")) {
        return { rows: [{ remaining_tokens: 10_000 }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });

    const status = await getSwarmBudgetStatus(context);

    expect(status).toEqual({
      status: "active",
      remainingTokens: 40_000,
      unassignedTokens: 30_000,
      deadlineAt: null,
      minimumSpawnAllocationTokens: 1_000_000,
      workers: [{ taskId: "worker-task", status: "active", remainingTokens: 6_000 }],
      children: [{ nodeId: "child-uuid", title: "Research", status: "active", remainingTokens: 13_000,
        deadlineAt: null, minimumGrantTokens: expect.any(Number) }]
    });
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("node_key = $1"), ["node-0", "workflow-1"]);
  });
});

describe("Agent Swarm quota notices", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = { query: vi.fn() };
  let workflowState: Record<string, unknown> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    workflowState = {};
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedQuery.mockResolvedValueOnce({ rows: [{
      node_id: "child-node", workflow_agent_id: "child-agent", role: "leader", lease_tokens: 14_110,
      member_spent_tokens: 14_000, member_reserved_tokens: 0, member_status: "active",
      allocated_tokens: 36_412, spent_tokens: 14_000, reserved_tokens: 0, system_reserve_tokens: 16_384,
      unassigned_tokens: 0, debt_tokens: 0, status: "paused", deadline_at: null,
      node_leader_task_id: "child-task", parent_leader_task_id: "root-task"
    }], rowCount: 1 } as never);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT phase, config_json")) {
        return { rows: [{ phase: "active", config_json: { swarmChannelIds: { "node-0": "global-channel", "child-key": "child-channel" } } }] };
      }
      if (sql.includes("parent_node.node_key")) return { rows: [{ node_key: "child-key", parent_node_key: "node-0" }] };
      if (sql.includes("SELECT state_json, phase")) return { rows: [{ phase: "active", state_json: workflowState }] };
      return { rows: [] };
    });
  });

  const notify = () => wakeParentForSwarmQuota({
    context: { ...context, taskId: "child-task" },
    triggerSource: "web",
    selectionUserId: "user-1",
    reason: "Swarm budget exhausted."
  });

  it("reports a child budget stop in the parent channel without touching the parent's history", async () => {
    workflowState = { pausedSwarmAgents: { "root-task": {
      sinceMessageNo: 3, status: "Waiting.", triggerSource: "web", selectionUserId: "user-1", mode: "agent_swarm_leader"
    } } };

    await notify();

    const sql = client.query.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.includes("INSERT INTO task_messages"))).toBe(false);
    expect(mockedQuery.mock.calls.some(([statement]) => String(statement).includes("INSERT INTO task_messages"))).toBe(false);
    const notice = client.query.mock.calls.find(([statement]) => String(statement).includes("INSERT INTO task_workflow_messages"));
    expect(notice?.[1]).toEqual(["workflow-1", "global-channel", "child-agent", expect.stringContaining("Swarm budget exhausted.")]);
    expect(vi.mocked(enqueueWorkflowTaskRun)).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "root-task", mode: "agent_swarm_leader", selectionUserId: "user-1"
    }));
  });

  it("does not queue a second run for a parent that is still running", async () => {
    await notify();

    expect(client.query.mock.calls.some(([statement]) => String(statement).includes("INSERT INTO task_workflow_messages"))).toBe(true);
    expect(vi.mocked(enqueueWorkflowTaskRun)).not.toHaveBeenCalled();
  });
});
