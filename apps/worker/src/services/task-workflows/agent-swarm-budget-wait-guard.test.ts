import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query } from "../../lib/db.js";
import { assertSwarmBudgetAllowsWaiting } from "./agent-swarm-budget-wait-guard.js";

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

describe("leader waits on a spent Swarm node", () => {
  const mockedQuery = vi.mocked(query);
  const outOfBudgetWorker = (pool: number) => mockedQuery.mockResolvedValue({ rows: [{
    unassigned_tokens: pool, is_root: true, task_id: "worker-2-task", slot_index: 1, step_tokens: 90_000
  }], rowCount: 1 } as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an open-ended wait once workers stopped on an empty pool", async () => {
    outOfBudgetWorker(10_000);

    await expect(assertSwarmBudgetAllowsWaiting(context, { waitingForTaskIds: null }))
      .rejects.toThrow(/Worker 2 stopped.*final_response/);
  });

  it("allows waiting on a named worker that is finishing a step", async () => {
    outOfBudgetWorker(10_000);

    await expect(assertSwarmBudgetAllowsWaiting(context, { waitingForTaskIds: ["worker-1-task"] })).resolves.toBeUndefined();
  });

  it("allows waiting once the pool can fund the stopped worker again", async () => {
    outOfBudgetWorker(500_000);

    await expect(assertSwarmBudgetAllowsWaiting(context, { waitingForTaskIds: null })).resolves.toBeUndefined();
  });

  it("allows waiting while every worker can still run", async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await expect(assertSwarmBudgetAllowsWaiting(context, { waitingForTaskIds: null })).resolves.toBeUndefined();
  });
});
