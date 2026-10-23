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
});
