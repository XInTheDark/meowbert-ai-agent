import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  clientQuery: vi.fn(),
  ensureWorkflowInitialRun: vi.fn(),
  insertTaskWithInitialUserMessage: vi.fn()
}));

vi.mock("../../lib/db.js", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("../tasks/task-service/index.js", () => ({ setTaskBranchSelection: vi.fn() }));
vi.mock("../tasks/task-service/time-limit.js", () => ({ activateTaskTimeLimitInTx: vi.fn() }));
vi.mock("../tasks/task-workflows.js", () => ({
  ensureWorkflowInitialRun: mocks.ensureWorkflowInitialRun,
  insertTaskWithInitialUserMessage: mocks.insertTaskWithInitialUserMessage,
  isTaskPrimaryKeyConflict: () => false
}));

import { createAgentSwarmTask } from "./creation.js";

const input = {
  workspaceId: "workspace-1",
  environmentId: "environment-1",
  initiatorUserId: "user-1",
  message: "Find every grant",
  defaultTimezone: "UTC",
  settings: normalizeAgentSwarmSettings({ leaderAgentId: "luna", budgetsEnabled: true, tokenBudget: 1_000_000 })
};

describe("createAgentSwarmTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withTransaction.mockImplementation(async (callback) => callback({ query: mocks.clientQuery }));
    mocks.insertTaskWithInitialUserMessage.mockResolvedValue({ userMessageId: "message-1", userMessageCreatedAt: "now" });
    mocks.ensureWorkflowInitialRun.mockResolvedValue({ runId: "run-1" });
  });

  it("creates the leader task with its swarm row and starts the leader", async () => {
    const result = await createAgentSwarmTask(input);

    expect(mocks.insertTaskWithInitialUserMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workflowType: "agent_swarm", message: "Find every grant" })
    );
    const swarmInsert = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_swarms"));
    expect(swarmInsert?.[1]).toEqual([
      result.taskId,
      JSON.stringify(input.settings),
      1_000_000,
      150_000,
      null
    ]);
    expect(mocks.ensureWorkflowInitialRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: result.taskId,
      userMessageId: "message-1",
      mode: "agent_swarm_leader"
    }));
    expect(result).toMatchObject({ runId: "run-1", userMessageId: "message-1", reusedExisting: false });
  });

  it("reuses an existing swarm task for a retried request", async () => {
    mocks.query.mockResolvedValue({ rows: [{ task_id: "task-1", user_message_id: "message-1" }], rowCount: 1 });

    const result = await createAgentSwarmTask({ ...input, taskId: "task-1" });

    expect(result).toEqual({ taskId: "task-1", runId: "run-1", userMessageId: "message-1", reusedExisting: true });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});
