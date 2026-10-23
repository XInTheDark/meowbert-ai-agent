import { describe, expect, it, vi } from "vitest";

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

function buildTask(workflowType: "agent_swarm" | "long_horizon" | null, allowWaiting = true) {
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
  it("turns a standard task into a swarm with only a swarm row", async () => {
    const query = vi.fn().mockResolvedValue(buildRowsResult([]));

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1",
      userId: "user-1",
      task: buildTask(null),
      workflow: { type: "agent_swarm", budgetsEnabled: true, advanced: { maxDepth: 1 } }
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET workflow_type = 'agent_swarm'"), ["task-1"]);
    const swarmInsert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_swarms"));
    expect(JSON.parse(swarmInsert?.[1][1])).toMatchObject({
      budgetsEnabled: true,
      tokenBudget: 10_000_000,
      advanced: { maxDepth: 1, maxLanesPerParent: 8 }
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO tasks"))).toBe(false);
  });

  it("keeps an existing swarm's settings that the request leaves out", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("AS legacy")) return buildRowsResult([{ legacy: false }]);
      if (sql.includes("SELECT config_json FROM task_swarms")) {
        return buildRowsResult([{ config_json: { routerId: "router-1", advanced: { maxDepth: 3 } } }]);
      }
      return buildRowsResult([]);
    });

    await applyWorkflowTransitionInTx({ query } as never, {
      taskId: "task-1",
      userId: "user-1",
      task: buildTask("agent_swarm"),
      workflow: { type: "agent_swarm", advanced: { autoCheck: false } }
    });

    const swarmInsert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_swarms"));
    expect(JSON.parse(swarmInsert?.[1][1] as string)).toMatchObject({
      routerId: "router-1",
      advanced: { maxDepth: 3, autoCheck: false }
    });
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

});
