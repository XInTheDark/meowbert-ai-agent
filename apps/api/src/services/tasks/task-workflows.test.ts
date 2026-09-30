import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  ensureDispatchedRun: vi.fn()
}));
const { query, withTransaction, ensureDispatchedRun } = mocks;

vi.mock("../../lib/db.js", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("./task-service/index.js", () => ({
  buildUserMessageContent: vi.fn(),
  normalizeTaskMessageToolOptions: vi.fn((value) => value),
  setTaskBranchSelection: vi.fn()
}));
vi.mock("./task-service/runs.js", () => ({ ensureDispatchedRun: mocks.ensureDispatchedRun }));
vi.mock("./task-service/time-limit.js", () => ({ activateTaskTimeLimitInTx: vi.fn() }));

import {
  createLongHorizonWorkflowTask,
  createAgentSwarmWorkflowTask,
  getTaskWorkflowOverview
} from "./task-workflows.js";

function buildRowsResult<Row extends object>(rows: Row[]) {
  return { rows, rowCount: rows.length };
}

function buildInput(taskId: string) {
  return {
    taskId,
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    initiatorUserId: "user-1",
    message: "Original task",
    defaultTimezone: "UTC"
  };
}

describe("workflow task creation retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureDispatchedRun.mockResolvedValue({
      runId: "run-1",
      attemptNo: 1,
      reusedExisting: true
    });
  });

  it("reuses an existing Long Horizon task instead of inserting a duplicate", async () => {
    query.mockResolvedValue(buildRowsResult([{
      task_id: "task-1",
      user_message_id: "message-1",
      run_id: "run-1"
    }]));

    const result = await createLongHorizonWorkflowTask(buildInput("task-1"));

    expect(result).toEqual({
      taskId: "task-1",
      runId: "run-1",
      userMessageId: "message-1",
      reusedExisting: true
    });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(ensureDispatchedRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      branchMessageId: "message-1",
      dispatchCategory: "new"
    }));
  });

  it("reuses an existing Agent Swarm task instead of inserting a duplicate", async () => {
    query.mockResolvedValue(buildRowsResult([{
      task_id: "task-1",
      user_message_id: "message-1",
      run_id: "run-1"
    }]));

    const result = await createAgentSwarmWorkflowTask({
      ...buildInput("task-1"),
      workerCount: 2,
      reviewRounds: 0
    });

    expect(result).toEqual({
      taskId: "task-1",
      runId: "run-1",
      userMessageId: "message-1",
      reusedExisting: true
    });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(ensureDispatchedRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      mode: "agent_swarm_leader",
      branchMessageId: "message-1"
    }));
  });

  it("includes Long Horizon reviewer task status in the workflow overview", async () => {
    query
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "long_horizon",
        phase: "reviewing",
        config_json: {},
        state_json: {}
      }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_agent_id: "reviewer-agent-1",
        task_id: "reviewer-task-1",
        slot_index: 0,
        title: "Reviewer 1",
        status: "running",
        updated_at: "2026-08-28T00:01:00Z"
      }]));

    const result = await getTaskWorkflowOverview("task-1");

    expect(result).toMatchObject({
      type: "long_horizon",
      longHorizon: {
        reviewers: [{
          workflow_agent_id: "reviewer-agent-1",
          task_id: "reviewer-task-1",
          slot_index: 0,
          status: "running"
        }]
      }
    });
  });

  it("lists spawned child-node leaders alongside Swarm workers", async () => {
    query
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_type: "agent_swarm",
        phase: "active",
        config_json: { workerCount: 0 },
        state_json: {}
      }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{
        workflow_agent_id: "child-leader-agent",
        role: "leader",
        task_id: "child-leader-task",
        slot_index: 1,
        title: "Check truck-count arithmetic",
        status: "running",
        updated_at: "2026-09-26T00:01:00Z"
      }]));

    const result = await getTaskWorkflowOverview("task-1");

    expect(result).toMatchObject({
      type: "agent_swarm",
      agentSwarm: {
        workerCount: 1,
        workers: [{ task_id: "child-leader-task", role: "leader", status: "running" }]
      }
    });
    const agentQuery = query.mock.calls.find(([sql]) => String(sql).includes("FROM task_workflow_agents a"));
    expect(agentQuery?.[0]).toContain("a.task_id <> $1");
  });
});
