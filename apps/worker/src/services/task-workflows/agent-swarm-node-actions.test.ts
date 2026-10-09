import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../../lib/queue.js", () => ({ taskQueue: { getJob: vi.fn() } }));
vi.mock("./shared.js", () => ({
  asObject: (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
  enqueueWorkflowTaskRun: vi.fn(),
  getSwarmToolOptionsOverride: vi.fn()
}));

import { withTransaction } from "../../lib/db.js";
import { enqueueWorkflowTaskRun } from "./shared.js";
import { grantSwarmNodeBudget } from "./agent-swarm-node-actions.js";

const leader = {
  id: "leader-agent", role: "leader" as const, slot_index: 0, task_id: "leader-task",
  title: "Leader", status: "running", task_root_path: "/tmp/task", last_inbox_refresh_message_no: 0,
  state_json: { swarmLeafId: "leader-leaf", swarmNodeIds: ["node-0"], swarmLeaderNodeIds: ["node-0"] }
};
const context = {
  workflowTaskId: "workflow-task", workflowType: "agent_swarm", phase: "active",
  config: {
    tokenBudget: 100_000,
    compiledSwarm: { rootNodeId: "node-0", nodes: [
      { id: "node-0", parentNodeId: null, leaderLeafId: "leader-leaf", workerLeafIds: [], title: "Root", reviewRounds: 0 }
    ], leaves: [] },
    swarmChannelIds: { "node-0": "global-channel" }
  },
  taskId: "leader-task", taskDir: "/tmp/task", workspaceId: "workspace", environmentId: "project",
  currentAgent: leader, agents: [leader], planContent: null
} satisfies LoadedWorkflowRunContext;

describe("Swarm child budget grants", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = { query: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, status, unassigned_tokens, deadline_at")) {
        return { rows: [{ id: "root-quota", status: "active", unassigned_tokens: 60_000, deadline_at: null }] };
      }
      if (sql.includes("SELECT id, leader_task_id, allocated_tokens")) {
        return { rows: [{ id: "child-quota", leader_task_id: "child-leader-task", allocated_tokens: 0,
          system_reserve_tokens: 0, spent_tokens: 0, reserved_tokens: 0, debt_tokens: 0,
          deadline_at: null, status: "paused" }] };
      }
      if (sql.includes("SELECT workflow_agent_id")) {
        return { rows: [{ workflow_agent_id: "child-leader-agent", role: "leader" }, { workflow_agent_id: "child-worker-agent", role: "worker" }] };
      }
      return { rows: [] };
    });
  });

  it("rejects a tiny first grant before resuming a seeded child", async () => {
    await expect(grantSwarmNodeBudget({
      context, nodeId: "child-quota", additionalTokens: 1_000, extendDeadlineMinutes: null
    })).rejects.toThrow("Grant too small");
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET allocated_tokens"))).toBe(false);
    expect(enqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("activates a seeded child, funds its worker, leaves the rest to its leader, and queues it", async () => {
    const result = await grantSwarmNodeBudget({
      context, nodeId: "child-quota", additionalTokens: 40_000, extendDeadlineMinutes: null
    });

    expect(result).toMatchObject({ nodeId: "child-quota", allocatedTokens: 40_000, resumed: true });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = CASE WHEN status = 'paused' THEN 'active'"),
      expect.arrayContaining(["child-quota", 40_000]));
    const leases = client.query.mock.calls.filter(([sql]) => String(sql).includes("SET lease_tokens = lease_tokens +"));
    expect(leases.map(([, args]) => [args[2], args[1]])).toEqual([
      ["child-leader-agent", 0],
      ["child-worker-agent", 8_192]
    ]);
    expect(enqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: "child-leader-task" }));
  });
});
