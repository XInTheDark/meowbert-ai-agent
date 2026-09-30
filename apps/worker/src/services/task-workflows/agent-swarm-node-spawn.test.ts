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
import { spawnSwarmNode } from "./agent-swarm-node-actions.js";

const nodeType = {
  id: "small-swarm", name: "Small swarm", description: "Three Luna workers", mode: "agent_swarm",
  spawnableAsNode: true, leaderAgentId: "sol", modelAllocations: [{ agentId: "luna", workerCount: 3 }], reviewRounds: 1
};
const baseContext = {
  workflowTaskId: "workflow-task", workflowType: "agent_swarm", phase: "active",
  config: {
    tokenBudget: 500_000,
    dynamicNodeTypes: [nodeType],
    compiledSwarm: { rootNodeId: "node-0", nodes: [
      { id: "node-0", parentNodeId: null, leaderLeafId: "leaf-0", workerLeafIds: [], title: "Root", reviewRounds: 0 }
    ], leaves: [] },
    swarmChannelIds: { "node-0": "global-channel" }
  },
  taskId: "leader-task", taskDir: "/tmp/task", workspaceId: "workspace", environmentId: "project",
  currentAgent: { id: "root-agent", role: "leader", task_id: "leader-task",
    state_json: { swarmLeafId: "leaf-0", swarmNodeIds: ["node-0"], swarmLeaderNodeIds: ["node-0"] } },
  agents: [{ id: "root-agent", role: "leader", task_id: "leader-task",
    state_json: { swarmLeafId: "leaf-0", swarmNodeIds: ["node-0"], swarmLeaderNodeIds: ["node-0"] } }],
  swarm: { globalChannelId: "global-channel" }
} as unknown as LoadedWorkflowRunContext;

describe("spawnSwarmNode", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = { query: vi.fn() };
  let nextAgent = 0;
  let context = structuredClone(baseContext);

  beforeEach(() => {
    vi.clearAllMocks();
    context = structuredClone(baseContext);
    nextAgent = 0;
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, depth, status")) return { rows: [{ id: "root-quota", depth: 1, status: "active",
        next_generation: 0, deadline_at: null, unassigned_tokens: 5_000_000, workflow_task_id: "workflow-task" }] };
      if (sql.includes("COUNT(*)::text AS count")) return { rows: [{ count: "1" }] };
      if (sql.includes("SELECT t.workspace_id, t.environment_id")) return { rows: [{
        workspace_id: "workspace", environment_id: "project", initiator_user_id: "user",
        default_timezone: "UTC", allow_waiting: true, title: "Task", state_json: {}, config_json: context.config
      }] };
      if (sql.includes("SELECT MAX(slot_index)::int AS max")) return { rows: [{ max: null }] };
      if (sql.includes("INSERT INTO task_workflow_agents")) return { rows: [{ id: `agent-${nextAgent++}` }] };
      if (sql.includes("INSERT INTO task_workflow_channels")) return { rows: [{ id: "child-channel" }] };
      if (sql.includes("content_json->>'text' AS text")) return { rows: [{ text: "How many trucks carry 80 flagstones?" }] };
      return { rows: [] };
    });
  });

  it("creates the leader and worker roster from the selected admin template", async () => {
    const result = await spawnSwarmNode({ context, nodeTypeId: "small-swarm", title: "Research",
      initialInstruction: "Investigate the evidence", tokenBudget: 1_000_000, timeBudgetMinutes: null });

    expect(result.workerTaskIds).toHaveLength(3);
    const agentInserts = client.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO task_workflow_agents"));
    expect(agentInserts.map(([, args]) => JSON.parse(args[4]).agentPresetId)).toEqual(["sol", "luna", "luna", "luna"]);
    expect(vi.mocked(enqueueWorkflowTaskRun)).toHaveBeenCalledWith(expect.objectContaining({
      taskId: result.leaderTaskId, mode: "agent_swarm_leader"
    }));
  });

  it("spawns an opted-in individual preset as a one-agent node", async () => {
    const soloContext = { ...context, config: { ...context.config,
      dynamicNodeTypes: [{ id: "luna", name: "Luna", description: "Focused research", spawnableAsNode: true }] }
    } as LoadedWorkflowRunContext;
    const result = await spawnSwarmNode({ context: soloContext, nodeTypeId: "luna", title: "Research",
      initialInstruction: "Check the evidence", tokenBudget: 1_000_000, timeBudgetMinutes: null });

    expect(result.workerTaskIds).toEqual([]);
    const agentInserts = client.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO task_workflow_agents"));
    expect(agentInserts).toHaveLength(1);
    expect(JSON.parse(agentInserts[0][1][4]).agentPresetId).toBe("luna");
    expect(vi.mocked(enqueueWorkflowTaskRun)).toHaveBeenCalledWith(expect.objectContaining({
      taskId: result.leaderTaskId, mode: "agent_swarm_leader"
    }));
  });

  it("preserves the reviewer mode on an opted-in individual preset", async () => {
    const reviewerContext = { ...context, config: { ...context.config,
      dynamicNodeTypes: [{ id: "reviewer", name: "Reviewer", description: "Quality review", mode: "quality_control_reviewer", spawnableAsNode: true }] }
    } as LoadedWorkflowRunContext;
    const result = await spawnSwarmNode({ context: reviewerContext, nodeTypeId: "reviewer", title: "Review",
      initialInstruction: "Check the evidence", tokenBudget: 1_000_000, timeBudgetMinutes: null });

    const agentInsert = client.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO task_workflow_agents"));
    expect(JSON.parse(agentInsert![1][4])).toMatchObject({ agentPresetId: "reviewer", agentPresetMode: "quality_control_reviewer" });
    expect(result.workerTaskIds).toEqual([]);
  });

  it("makes the parent wait for the spawned node instead of finishing or stalling", async () => {
    const result = await spawnSwarmNode({ context, nodeTypeId: "small-swarm", title: "Research",
      initialInstruction: null, tokenBudget: 1_000_000, timeBudgetMinutes: null });

    const workflowUpdate = client.query.mock.calls.find(([sql]) => sql.includes("UPDATE task_workflows SET config_json"));
    expect(JSON.parse(workflowUpdate![1][2]).startedSwarmWorkerTaskIds).toEqual([result.leaderTaskId]);
    expect(context.swarm?.pendingNestedSwarmNodeIds).toEqual([result.nodeId]);
    expect(context.agents).toContainEqual(expect.objectContaining({
      task_id: result.leaderTaskId, role: "leader", status: "queued"
    }));
  });

  it("gives every spawned agent the swarm task, not just the parent's instruction", async () => {
    await spawnSwarmNode({ context, nodeTypeId: "small-swarm", title: "Verify",
      initialInstruction: "Solve it independently", tokenBudget: 1_000_000, timeBudgetMinutes: null });

    const seeds = client.query.mock.calls
      .filter(([sql]) => sql.includes("INSERT INTO task_messages"))
      .map(([, args]) => JSON.parse(args[1]).text as string);
    expect(seeds).toHaveLength(4);
    for (const seed of seeds) expect(seed).toContain("How many trucks carry 80 flagstones?");
  });

  it("ignores a requested child time budget when the swarm has no deadline", async () => {
    const result = await spawnSwarmNode({ context, nodeTypeId: "small-swarm", title: "Research",
      initialInstruction: null, tokenBudget: 1_000_000, timeBudgetMinutes: 30 });

    expect(result.deadlineAt).toBeNull();
  });

  it("rejects child budgets below one million weighted tokens", async () => {
    await expect(spawnSwarmNode({ context, nodeTypeId: "small-swarm", title: "Research",
      initialInstruction: null, tokenBudget: 999_999, timeBudgetMinutes: null }))
      .rejects.toThrow("Minimum required is 1000000 weighted tokens.");
    expect(mockedWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects Swarm presets without an explicit spawn opt-in", async () => {
    for (const spawnableAsNode of [false, undefined]) {
      const disabledContext = { ...context, config: { ...context.config,
        dynamicNodeTypes: [{ ...nodeType, spawnableAsNode }] } } as LoadedWorkflowRunContext;
      await expect(spawnSwarmNode({ context: disabledContext, nodeTypeId: "small-swarm", title: "Research",
        initialInstruction: null, tokenBudget: 1_000_000, timeBudgetMinutes: null }))
        .rejects.toThrow("Unknown or non-spawnable Swarm node type");
    }
    expect(mockedWithTransaction).not.toHaveBeenCalled();
  });
});
