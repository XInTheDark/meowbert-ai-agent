import { describe, expect, it, vi } from "vitest";
import { compilePlatformAgentSwarm, type PlatformAgentPreset } from "@meowbert/shared";

vi.mock("../../lib/config.js", () => ({
  config: {
    limits: {}
  }
}));

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../billing/entitlements.js", () => ({
  getPromptEntitlementStatus: vi.fn()
}));

vi.mock("./recurring-run-entitlement.js", () => ({
  recordRecurringRunPromptUsageIfRequired: vi.fn(),
  resolveRecurringRunPromptEntitlement: vi.fn()
}));

vi.mock("./task-service/index.js", () => ({
  enqueueRun: vi.fn()
}));

import {
  applyWorkflowTransitionInTx,
  assertTaskTypeTransitionIdleInTx
} from "./task-workflow-transitions.js";

function buildRowsResult<Row extends object>(rows: Row[]) {
  return {
    rows,
    rowCount: rows.length
  };
}

function buildTask(workflowType: "agent_swarm" | null, allowWaiting = true) {
  return {
    id: "task-1",
    workspace_id: "workspace-1",
    environment_id: "environment-1",
    default_timezone: "UTC",
    allow_waiting: allowWaiting,
    workflow_type: workflowType,
    title: "Task"
  } as const;
}

describe("assertTaskTypeTransitionIdleInTx", () => {
  it("rejects a transition while a task scope has active work", async () => {
    const query = vi.fn().mockResolvedValue(buildRowsResult([{ id: "task-1" }]));

    await expect(assertTaskTypeTransitionIdleInTx({ query } as never, "task-1"))
      .rejects.toMatchObject({
        message: "Stop the task before changing its type.",
        statusCode: 409
      });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status IN ('starting', 'running')"), ["task-1"]);
  });
});

describe("applyWorkflowTransitionInTx", () => {
  it("stores compiled swarm member presets when converting an existing standard task", async () => {
    const presets: PlatformAgentPreset[] = [
      { id: "luna", name: "Luna", description: "", requiresSuperAdmin: false, payload: { model: "gpt-6-luna" } },
      { id: "quality", name: "Quality", description: "", requiresSuperAdmin: false, payload: { model: "gpt-6-luna" }, mode: "quality_control_reviewer" }
    ];
    const compiledSwarm = compilePlatformAgentSwarm({
      presets,
      leaderAgentId: "luna",
      modelAllocations: [{ agentId: "luna", workerCount: 2 }, { agentId: "quality", workerCount: 1 }],
      reviewRounds: 1
    });
    let nextAgent = 0;
    let nextChannel = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO task_workflow_agents")) return buildRowsResult([{ id: `agent-${nextAgent++}` }]);
      if (sql.includes("INSERT INTO task_workflow_channels")) return buildRowsResult([{ id: `channel-${nextChannel++}` }]);
      if (sql.includes("INSERT INTO task_workflow_swarm_nodes")) return buildRowsResult([{ id: "quota-node-1" }]);
      return buildRowsResult([]);
    });

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1",
      userId: "user-1",
      task: buildTask(null),
      workflow: {
        type: "agent_swarm", workerCount: 3, reviewRounds: 1,
        leaderAgentId: "luna",
        modelAllocations: [{ agentId: "luna", workerCount: 2 }, { agentId: "quality", workerCount: 1 }]
      },
      compiledSwarm,
      dynamicNodeTypes: [{ id: "research-swarm", name: "Research swarm", description: "A research node.",
        requiresSuperAdmin: false, payload: {}, mode: "agent_swarm", leaderAgentId: "luna",
        modelAllocations: [{ agentId: "luna", workerCount: 3 }] }],
      promptOverride: "Current follow-up"
    });

    const agentInserts = query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO task_workflow_agents"));
    expect(agentInserts.map(([, args]) => JSON.parse(args[4]).agentPresetId)).toEqual([
      "luna", "luna", "luna", "quality"
    ]);
    const workflowInsert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO task_workflows"));
    expect(JSON.parse(workflowInsert?.[1][3])).toMatchObject({
      compiledSwarm,
      tokenBudget: 10_000_000,
      timeBudgetMinutes: null,
      dynamicNodeTypes: [expect.objectContaining({ id: "research-swarm", modelAllocations: [{ agentId: "luna", workerCount: 3 }] })]
    });
    const workerMessages = query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO task_messages"));
    expect(workerMessages).toHaveLength(3);
    expect(workerMessages.every(([, args]) => args.some((value: unknown) => (
      typeof value === "string" && value.includes("Current follow-up")
    )))).toBe(true);
  });

  it("creates a root topology for a converted flat Swarm so its leader can spawn templates", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO task_workflow_agents")) return buildRowsResult([{ id: "leader-agent" }]);
      if (sql.includes("INSERT INTO task_workflow_swarm_nodes")) return buildRowsResult([{ id: "quota-root" }]);
      if (sql.includes("INSERT INTO task_workflow_channels")) return buildRowsResult([{ id: "global-channel" }]);
      return buildRowsResult([]);
    });

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1", userId: "user-1", task: buildTask(null),
      workflow: { type: "agent_swarm", workerCount: 0, leaderAgentId: "luna", tokenBudget: 50_000_000 },
      dynamicNodeTypes: [{ id: "research-swarm", name: "Research swarm", description: "Three Luna workers",
        requiresSuperAdmin: false, payload: {}, mode: "agent_swarm", leaderAgentId: "luna",
        modelAllocations: [{ agentId: "luna", workerCount: 3 }] }]
    });

    const workflowInsert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO task_workflows"));
    expect(JSON.parse(workflowInsert?.[1][3])).toMatchObject({
      compiledSwarm: { rootNodeId: "node-0", nodes: [{ leaderLeafId: "leaf-0", workerLeafIds: [] }] },
      dynamicNodeTypes: [expect.objectContaining({ id: "research-swarm" })]
    });
    const leaderInsert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO task_workflow_agents"));
    const leaderState = JSON.parse(leaderInsert?.[1][4]);
    expect(leaderState).toMatchObject({ swarmLeafId: "leaf-0", swarmLeaderNodeIds: ["node-0"] });
    expect(leaderState).not.toHaveProperty("agentPresetId");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE task_workflows SET config_json"),
      ["task-1", JSON.stringify({ swarmChannelIds: { "node-0": "global-channel" } })]
    );
  });

  it("creates a Swarm without quota or spawnable nodes when spawning and budgets are disabled", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO task_workflow_agents")) return buildRowsResult([{ id: "leader-agent" }]);
      if (sql.includes("INSERT INTO task_workflow_channels")) return buildRowsResult([{ id: "global-channel" }]);
      return buildRowsResult([]);
    });

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1", userId: "user-1", task: buildTask(null),
      workflow: { type: "agent_swarm", workerCount: 0, leaderAgentId: "luna",
        tokenBudget: 50_000_000, timeBudgetMinutes: 30, disableSpawningAndBudgets: true },
      dynamicNodeTypes: [{ id: "research-swarm", name: "Research swarm", description: "Three Luna workers",
        requiresSuperAdmin: false, payload: {}, mode: "agent_swarm", leaderAgentId: "luna",
        modelAllocations: [{ agentId: "luna", workerCount: 3 }] }]
    });

    const workflowInsert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO task_workflows"));
    expect(JSON.parse(workflowInsert?.[1][3])).toMatchObject({ tokenBudget: null, timeBudgetMinutes: null, dynamicNodeTypes: [] });
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO task_workflow_swarm_nodes"))).toBe(false);
  });

  it("clears an existing Swarm deadline when its time limit is disabled", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT (config_json->>'tokenBudget')")) {
        return buildRowsResult([{ token_budget: 50_000_000, compiled_swarm: null }]);
      }
      if (sql.includes("ORDER BY role ASC, slot_index ASC")) {
        return buildRowsResult([{ id: "leader-agent", role: "leader", state_json: {} }]);
      }
      if (sql.includes("SELECT id, allocated_tokens, spent_tokens, reserved_tokens, debt_tokens")) {
        return buildRowsResult([{ id: "quota-root", allocated_tokens: 50_000_000,
          spent_tokens: 0, reserved_tokens: 0, debt_tokens: 0 }]);
      }
      return buildRowsResult([]);
    });

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1",
      userId: "user-1",
      task: buildTask("agent_swarm"),
      workflow: { type: "agent_swarm", workerCount: 0, tokenBudget: 50_000_000, timeBudgetMinutes: null }
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET deadline_at = $2"),
      ["quota-root", null]
    );
  });

  it("creates a missing Long Horizon reviewer when review is enabled", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ content_json: { text: "Original task" } }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "reviewer-agent" }]))
      .mockResolvedValueOnce(buildRowsResult([]));

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1",
      userId: "user-1",
      task: buildTask("long_horizon"),
      workflow: {
        type: "long_horizon",
        tokenBudget: null,
        timeBudgetMinutes: null,
        enableClarifyPhase: true,
        enableReviewPhase: true
      }
    });

    const childInsert = query.mock.calls.find(([sql]) => (
      typeof sql === "string" && sql.includes("INSERT INTO tasks")
    ));
    expect(childInsert?.[1]).toEqual([
      expect.any(String),
      "workspace-1",
      "environment-1",
      "Task · Reviewer 1",
      "user-1",
      "UTC",
      false,
      expect.stringContaining(".meowbert/task-runs/"),
      "long_horizon",
      "task-1",
      "reviewer"
    ]);
  });

  it("reconciles added Agent Swarm workers and preserves the parent wait policy", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{ token_budget: null }]))
      .mockResolvedValueOnce(buildRowsResult([
        { agentId: "agent-1", taskId: "worker-1", slotIndex: 0, status: "awaiting_input" },
        { agentId: "agent-2", taskId: "worker-2", slotIndex: 1, status: "awaiting_input" },
        { agentId: "agent-3", taskId: "worker-3", slotIndex: 2, status: "awaiting_input" }
      ]))
      .mockResolvedValueOnce(buildRowsResult([{ content_json: { text: "Original task" } }]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "global-channel" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "agent-4" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1",
      userId: "user-1",
      task: buildTask("agent_swarm", false),
      workflow: {
        type: "agent_swarm",
        workerCount: 4,
        reviewRounds: 0,
        leaderAgentId: null,
        modelAllocations: [],
        tokenBudget: null
      }
    });

    const childInsert = query.mock.calls.find(([sql]) => (
      typeof sql === "string" && sql.includes("INSERT INTO tasks")
    ));
    expect(childInsert?.[1]).toEqual([
      expect.any(String),
      "workspace-1",
      "environment-1",
      "Task · Worker 4",
      "user-1",
      "UTC",
      false,
      expect.stringContaining(".meowbert/task-runs/"),
      "agent_swarm",
      "task-1",
      "worker"
    ]);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("SET config_json = config_json || $2::jsonb"),
      ["task-1", expect.stringContaining('"workerCount":4')]
    );
  });
});
