import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "../../lib/db.js";
import {
  reserveSwarmInference,
  settleSwarmInference,
  type SwarmInferenceReservation
} from "./agent-swarm-budget.js";

const context = {
  workflowTaskId: "workflow-1",
  workflowType: "agent_swarm",
  phase: "active",
  config: { tokenBudget: 1_000_000 },
  taskId: "agent-task",
  taskDir: "/tmp/task",
  workspaceId: "workspace-1",
  environmentId: "environment-1",
  currentAgent: {
    id: "agent-1", role: "leader", slot_index: 0, task_id: "agent-task", title: "Leader", status: "running",
    task_root_path: "/tmp/task", last_inbox_refresh_message_no: 0, state_json: {}
  },
  agents: [],
  planContent: null
} satisfies LoadedWorkflowRunContext;

// With no recorded usage, one step reserves the 8,192-token minimum.
const STEP = 8_192;

const rows = (value: Array<Record<string, unknown>>, rowCount = value.length) => ({ rows: value, rowCount });

interface ReserveSetup {
  role: "leader" | "worker";
  pool: number;
  reserve?: number;
  memberSpent?: number;
  delegated?: number;
  deadlineAt?: string | null;
  lowBudgetClaimed?: boolean;
  othersOutOfBudget?: number;
}

describe("Agent Swarm shared node pool", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = { query: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  // 1M allocated: 900k operating, so the leader's fixed share is 180k.
  const setupReserve = (setup: ReserveSetup) => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("member.id AS workflow_agent_id")) {
        return rows([{ node_id: "node-1", workflow_agent_id: "agent-1", role: setup.role,
          node_leader_task_id: "leader-task", parent_leader_task_id: null }]) as never;
      }
      if (sql.includes("WITH paused AS")) {
        return rows([{ newly_paused: true, others_paused: setup.othersOutOfBudget ?? 0 }]) as never;
      }
      return rows([]) as never;
    });
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT status, deadline_at, allocated_tokens")) {
        return rows([{ status: "active", deadline_at: setup.deadlineAt ?? null, allocated_tokens: 1_000_000,
          system_reserve_tokens: setup.reserve ?? 100_000, unassigned_tokens: setup.pool }]);
      }
      if (sql.includes("SELECT status, spent_tokens, reserved_tokens")) {
        return rows([{ status: "active", spent_tokens: setup.memberSpent ?? 0, reserved_tokens: 0 }]);
      }
      if (sql.includes("delegated_tokens")) return rows([{ delegated_tokens: setup.delegated ?? 0 }]);
      if (sql.includes("SELECT COUNT(*) AS count")) return rows([{ count: 6 }]);
      if (sql.includes("SET low_budget_notified = true")) return rows([], setup.lowBudgetClaimed === false ? 0 : 1);
      if (sql.includes("INSERT INTO task_workflow_swarm_quota_reservations")) return rows([{ id: "reservation-1" }]);
      return rows([]);
    });
    return reserveSwarmInference(context, false, "run-1");
  };
  const debitedFromReserve = () => {
    const debit = client.query.mock.calls.find(([sql]) => String(sql).includes("SET reserved_tokens = reserved_tokens + $2"));
    return debit?.[1][2];
  };

  it("funds a worker's step from the node's shared pool", async () => {
    const reservation = await setupReserve({ role: "worker", pool: 500_000 });

    expect(reservation).toMatchObject({ role: "worker", recovery: false, lowBudget: false, requestedTokens: STEP });
    expect(debitedFromReserve()).toBe(false);
  });

  it("stops a worker when the pool cannot fund its step and alerts the leader for the first one only", async () => {
    await expect(setupReserve({ role: "worker", pool: 1_000 })).rejects.toMatchObject({
      reason: "worker_budget_exhausted",
      notify: true
    });
    await expect(setupReserve({ role: "worker", pool: 1_000, othersOutOfBudget: 1 })).rejects.toMatchObject({
      reason: "worker_budget_exhausted",
      notify: false
    });
    expect(debitedFromReserve()).toBeUndefined();
  });

  it("never lets a worker spend the protected reserve", async () => {
    await expect(setupReserve({ role: "worker", pool: 0, reserve: 500_000 })).rejects.toMatchObject({
      reason: "worker_budget_exhausted"
    });
  });

  it("warns each agent once when the pool can cover only a few more steps", async () => {
    // Six agents at three steps each is 147,456 tokens, more than the 91,808 left after this step.
    await expect(setupReserve({ role: "worker", pool: 100_000 })).resolves.toMatchObject({ lowBudget: true });
    await expect(setupReserve({ role: "worker", pool: 100_000, lowBudgetClaimed: false })).resolves.toMatchObject({ lowBudget: false });
  });

  it("moves a leader to the reserve once the pool is spent", async () => {
    const reservation = await setupReserve({ role: "leader", pool: 0 });

    expect(reservation).toMatchObject({ recovery: true, overLeaderAllowance: false });
    expect(debitedFromReserve()).toBe(true);
  });

  it("pauses the node when neither the pool nor the reserve can fund a leader step", async () => {
    await expect(setupReserve({ role: "leader", pool: 0, reserve: 0 })).rejects.toMatchObject({ reason: "budget_exhausted" });
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("paused_reason = $2"), ["node-1", "budget_exhausted"]);
  });

  it("persists a deadline pause even though the reservation transaction rolls back", async () => {
    await expect(setupReserve({ role: "leader", pool: 500_000, deadlineAt: "2020-01-01T00:00:00.000Z" }))
      .rejects.toMatchObject({ reason: "deadline_reached" });
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("paused_reason = $2"), ["node-1", "deadline_reached"]);
  });

  describe("leader share", () => {
    it("lets a leader within its share draw from the pool", async () => {
      await expect(setupReserve({ role: "leader", pool: 500_000, memberSpent: 100_000 }))
        .resolves.toMatchObject({ recovery: false, overLeaderAllowance: false });
    });

    it("moves a leader past its share onto the reserve without pausing it", async () => {
      await expect(setupReserve({ role: "leader", pool: 500_000, memberSpent: 180_000 }))
        .resolves.toMatchObject({ recovery: true, overLeaderAllowance: true });
      expect(mockedQuery.mock.calls.some(([sql]) => String(sql).includes("status = 'paused'"))).toBe(false);
    });

    it("raises the share as its workers spend", async () => {
      await expect(setupReserve({ role: "leader", pool: 500_000, memberSpent: 300_000, delegated: 400_000 }))
        .resolves.toMatchObject({ recovery: false, overLeaderAllowance: false });
    });

    it("keeps drawing from the pool when the reserve cannot cover the step", async () => {
      await expect(setupReserve({ role: "leader", pool: 500_000, memberSpent: 300_000, reserve: 1_000 }))
        .resolves.toMatchObject({ recovery: false, overLeaderAllowance: false });
    });
  });

  describe("settlement", () => {
    const reservation: SwarmInferenceReservation = {
      reservationId: "reservation-1", requestedTokens: STEP, nodeId: "node-1", workflowAgentId: "agent-1",
      role: "worker", recovery: false, overLeaderAllowance: false, lowBudget: false, runId: "run-1"
    };
    const settle = (row: { recovery: boolean; deadlineAt?: string | null }, actual: number) => {
      client.query.mockImplementation(async (sql: string) => sql.includes("FROM task_workflow_swarm_quota_reservations r")
        ? rows([{ requested_tokens: STEP, recovery: row.recovery, status: "active", quota_generation: 0,
          node_generation: 0, node_status: "active", deadline_at: row.deadlineAt ?? null }])
        : rows([]));
      return settleSwarmInference(context, { ...reservation, recovery: row.recovery }, actual);
    };
    const nodeCharge = () => client.query.mock.calls.find(([sql]) => String(sql).includes("debt_tokens = debt_tokens +"));

    it("charges the actual cost and returns the unused part to the pool", async () => {
      await expect(settle({ recovery: false }, 5_000)).resolves.toBe(true);
      expect(nodeCharge()?.[1]).toEqual(["node-1", STEP, 5_000, false]);
    });

    it("returns the unused part of a reserve step to the reserve", async () => {
      await expect(settle({ recovery: true }, 5_000)).resolves.toBe(true);
      expect(nodeCharge()?.[1]).toEqual(["node-1", STEP, 5_000, true]);
    });

    it("discards a response that arrives after the deadline and refunds its reservation", async () => {
      await expect(settle({ recovery: false, deadlineAt: "2020-01-01T00:00:00.000Z" }, 7_000)).resolves.toBe(false);
      expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'paused'"), ["node-1"]);
      expect(client.query).toHaveBeenCalledWith(expect.stringContaining("SET settled_tokens = $2, status = $3"), ["reservation-1", 7_000, "expired"]);
      expect(client.query).toHaveBeenCalledWith(expect.stringContaining("unassigned_tokens + $2"), ["node-1", STEP, false]);
      expect(nodeCharge()).toBeUndefined();
    });
  });
});
