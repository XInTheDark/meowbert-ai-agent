import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query } from "../../lib/db.js";
import { getSwarmBudgetStatus } from "./agent-swarm-budget-status.js";

const leader = {
  id: "leader-agent", role: "leader" as const, slot_index: 0, task_id: "leader-task", title: "Leader", status: "running",
  task_root_path: "/tmp/task", last_inbox_refresh_message_no: 0, state_json: {}
};
const context = {
  workflowTaskId: "workflow-1",
  workflowType: "agent_swarm",
  phase: "active",
  config: { tokenBudget: 1_000_000 },
  taskId: "leader-task",
  taskDir: "/tmp/task",
  workspaceId: "workspace-1",
  environmentId: "environment-1",
  currentAgent: leader,
  agents: [leader],
  planContent: null
} satisfies LoadedWorkflowRunContext;

describe("Swarm budget status", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM task_workflow_swarm_nodes") && sql.includes("node_key = $1")) {
        return { rows: [{ id: "node-uuid", status: "active", unassigned_tokens: 600_000,
          system_reserve_tokens: 100_000, deadline_at: null }], rowCount: 1 } as never;
      }
      if (sql.includes("member.role = 'worker'") && sql.includes("ORDER BY member.slot_index")) {
        return { rows: [
          { task_id: "worker-1-task", slot_index: 0, title: "W1", status: "active", spent_tokens: 150_000, reserved_tokens: 10_000 },
          { task_id: "worker-2-task", slot_index: 1, title: "W2", status: "paused", spent_tokens: 90_000, reserved_tokens: 0 }
        ], rowCount: 2 } as never;
      }
      if (sql.includes("parent_node_id = $1")) {
        return { rows: [{ id: "child-uuid", title: "Research", status: "active", allocated_tokens: 2_000_000,
          unassigned_tokens: 1_200_000, deadline_at: null, worker_slots: 1 }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
  });

  it("shows the shared pool, the reserve, each worker's spend, and child pools", async () => {
    const status = await getSwarmBudgetStatus(context);

    expect(status).toEqual({
      status: "active",
      poolTokens: 600_000,
      protectedReserveTokens: 100_000,
      lowBudget: false,
      deadlineAt: null,
      minimumSpawnAllocationTokens: 1_000_000,
      workers: [
        { label: "Worker 1", taskId: "worker-1-task", status: "active", spentTokens: 160_000 },
        { label: "Worker 2", taskId: "worker-2-task", status: "out_of_budget", spentTokens: 90_000 }
      ],
      children: [{ nodeId: "child-uuid", title: "Research", status: "active", remainingTokens: 1_200_000,
        deadlineAt: null, minimumGrantTokens: expect.any(Number) }]
    });
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("node_key = $1"), ["node-0", "workflow-1"]);
  });
});
