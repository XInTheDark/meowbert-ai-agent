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

vi.mock("../../services/billing/entitlements.js", () => ({
  getPromptEntitlementStatus: vi.fn()
}));

vi.mock("../../services/tasks/recurring-run-entitlement.js", () => ({
  recordRecurringRunPromptUsageIfRequired: vi.fn(),
  resolveRecurringRunPromptEntitlement: vi.fn()
}));

vi.mock("../../services/tasks/task-service/index.js", () => ({
  enqueueRun: vi.fn()
}));

import { createTaskBodySchema, taskForkBody, taskParametersPatchBody } from "./shared.js";

describe("taskForkBody", () => {
  it("accepts the task-file copy option for private forks", () => {
    expect(taskForkBody.parse({ copyTaskFiles: false })).toEqual({ copyTaskFiles: false });
    expect(taskForkBody.parse({ copyTaskFiles: true })).toEqual({ copyTaskFiles: true });
  });
});

describe("taskParametersPatchBody", () => {
  it("accepts workflow patch with standard and long_horizon types", () => {
    const standardParsed = taskParametersPatchBody.parse({
      workflow: { type: "standard" }
    });
    expect(standardParsed.workflow?.type).toBe("standard");

    const longHorizonParsed = taskParametersPatchBody.parse({
      workflow: {
        type: "long_horizon",
        tokenBudget: 50_000
      }
    });
    expect(longHorizonParsed.workflow).toEqual({
      type: "long_horizon",
      tokenBudget: 50_000
    });
  });

  it("accepts workflow patch with agent_swarm type", () => {
    const swarmParsed = taskParametersPatchBody.parse({
      workflow: {
        type: "agent_swarm",
        workerCount: 4,
        reviewRounds: 1,
        leaderAgentId: "agent-1",
        modelAllocations: [{ agentId: "agent-1", workerCount: 4 }]
      }
    });
    expect(swarmParsed.workflow?.type).toBe("agent_swarm");
    expect(swarmParsed.workflow?.workerCount).toBe(4);
  });
});

describe("createTaskBodySchema", () => {
  it("accepts incognito task creation", () => {
    const parsed = createTaskBodySchema.parse({
      message: "keep this off the task list",
      incognito: true
    });

    expect(parsed.incognito).toBe(true);
  });

  it("accepts canvas attachments and interactive canvas task fields", () => {
    const parsed = createTaskBodySchema.parse({
      message: "Update this canvas",
      interactiveCanvasId: "11111111-1111-4111-8111-111111111111",
      interactiveCanvasIntent: "update",
      attachments: [
        {
          kind: "canvas",
          label: "Quadratics Lab",
          content: "Canvas: Quadratics Lab",
          relativePath: "canvases/quadratics-lab"
        }
      ]
    });

    expect(parsed.interactiveCanvasId).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.interactiveCanvasIntent).toBe("update");
    expect(parsed.attachments?.[0]?.kind).toBe("canvas");
  });

  it("accepts Quality control as a workflow composer mode", () => {
    const parsed = createTaskBodySchema.parse({
      message: "Polish this report",
      workflow: {
        type: "quality_control",
        tokenBudget: 75_000
      }
    });

    expect(parsed.workflow).toEqual({
      type: "quality_control",
      tokenBudget: 75_000
    });
  });

  it("accepts Deep Research as a workflow composer mode", () => {
    const parsed = createTaskBodySchema.parse({
      message: "Research this thoroughly",
      workflow: {
        type: "deep_research",
        tokenBudget: 75_000
      }
    });

    expect(parsed.workflow).toEqual({
      type: "deep_research",
      tokenBudget: 75_000
    });
  });

  it("accepts timeBudgetMinutes and phase toggles in workflow create schema", () => {
    const parsed = createTaskBodySchema.parse({
      message: "Long running task",
      workflow: {
        type: "long_horizon",
        tokenBudget: 50_000,
        timeBudgetMinutes: 60,
        enableClarifyPhase: false,
        enableReviewPhase: true
      }
    });

    expect(parsed.workflow).toEqual({
      type: "long_horizon",
      tokenBudget: 50_000,
      timeBudgetMinutes: 60,
      enableClarifyPhase: false,
      enableReviewPhase: true
    });
  });

  it("accepts Agent Swarm budgets and an optional deadline with the default token budget", () => {
    const parsed = createTaskBodySchema.parse({
      message: "Bounded swarm task",
      workflow: {
        type: "agent_swarm",
        workerCount: 3,
        modelAllocations: [{ agentId: "agent-1", workerCount: 3 }],
        tokenBudget: 80_000,
        timeBudgetMinutes: 60
      }
    });

    expect(parsed.workflow?.tokenBudget).toBe(80_000);
    expect(parsed.workflow?.timeBudgetMinutes).toBe(60);
    const deadlineWithDefaultBudget = createTaskBodySchema.parse({
      message: "Deadline with default envelope",
      workflow: { type: "agent_swarm", workerCount: 3, timeBudgetMinutes: 60 }
    });
    expect(deadlineWithDefaultBudget.workflow?.timeBudgetMinutes).toBe(60);
  });
});
