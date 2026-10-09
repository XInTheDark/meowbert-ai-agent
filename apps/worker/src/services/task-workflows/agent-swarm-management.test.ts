import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../../lib/queue.js", () => ({
  taskQueue: {
    getJob: vi.fn()
  }
}));

vi.mock("./agent-swarm-mailbox.js", () => ({
  removeSwarmPauses: vi.fn()
}));

vi.mock("./shared.js", async () => {
  const actual = await vi.importActual<typeof import("./shared.js")>("./shared.js");
  return {
    ...actual,
    enqueueWorkflowTaskRun: vi.fn(),
    getSwarmToolOptionsOverride: vi.fn()
  };
});

import { query, withTransaction } from "../../lib/db.js";
import { removeSwarmPauses } from "./agent-swarm-mailbox.js";
import { manageSwarmWorkers } from "./agent-swarm-management.js";
import { enqueueWorkflowTaskRun, getSwarmToolOptionsOverride } from "./shared.js";

function createContext(): LoadedWorkflowRunContext {
  return {
    workflowTaskId: "workflow-1",
    workflowType: "agent_swarm",
    phase: "active",
    config: {},
    taskId: "leader-task",
    taskDir: "/tmp/leader",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    currentAgent: {
      id: "leader-agent",
      role: "leader",
      slot_index: 0,
      task_id: "leader-task",
      title: "Leader",
      status: "running",
      task_root_path: ".meowbert/task-runs/leader-task",
      last_inbox_refresh_message_no: 0,
      state_json: {}
    },
    agents: [1, 2].map((number) => ({
      id: `worker-agent-${number}`,
      role: "worker" as const,
      slot_index: number - 1,
      task_id: `worker-task-${number}`,
      title: `Worker ${number}`,
      status: "queued",
      task_root_path: `.meowbert/task-runs/worker-task-${number}`,
      last_inbox_refresh_message_no: 0,
      state_json: {}
    })),
    planContent: null
  };
}

describe("Agent Swarm worker management", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedRemoveSwarmPauses = vi.mocked(removeSwarmPauses);
  const mockedEnqueueWorkflowTaskRun = vi.mocked(enqueueWorkflowTaskRun);
  const transactionClient = { query: vi.fn() };
  let workflowState: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    workflowState = {};
    const workers = [
      {
        task_id: "leader-task",
        role: "leader",
        slot_index: 0,
        title: "Leader",
        status: "running",
        cancellation_requested: false,
        has_live_run: true
      },
      {
        task_id: "worker-task-1",
        role: "worker",
        slot_index: 0,
        title: "Worker 1",
        status: "awaiting_input",
        cancellation_requested: false,
        has_live_run: false
      },
      {
        task_id: "worker-task-2",
        role: "worker",
        slot_index: 1,
        title: "Worker 2",
        status: "awaiting_input",
        cancellation_requested: false,
        has_live_run: false
      }
    ];
    mockedQuery.mockImplementation(async () => {
      const rows = workers.map((worker) => ({ ...worker, workflow_state_json: workflowState }));
      return { rows, rowCount: rows.length } as never;
    });
    transactionClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    mockedWithTransaction.mockImplementation(async (callback) => callback(transactionClient as never));
    mockedEnqueueWorkflowTaskRun.mockResolvedValue({ runId: "run-1", attemptNo: 1 });
    vi.mocked(getSwarmToolOptionsOverride).mockReturnValue(undefined);
  });

  it("resumes only explicitly selected workers and clears their pauses before enqueueing", async () => {
    const result = await manageSwarmWorkers({
      context: createContext(),
      start: ["Worker 1"],
      stop: [],
      grantBudget: [],
      viewOnly: false
    });

    expect(mockedRemoveSwarmPauses).toHaveBeenCalledWith(
      transactionClient,
      "workflow-1",
      ["worker-task-1"]
    );
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "worker-task-1",
      mode: "agent_swarm_worker"
    }));
    expect(result.started).toEqual(["Worker 1"]);
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE task_workflows SET state_json"),
      ["workflow-1", expect.stringContaining('"startedSwarmWorkerTaskIds":["worker-task-1"]')]
    );
  });

  it("lets a nested leader manage only the workers in its node", async () => {
    const context = createContext();
    const nestedLeader = context.agents[0];
    nestedLeader.state_json = {
      swarmLeafId: "nested-leader",
      swarmNodeIds: ["nested-node", "root-node"],
      swarmLeaderNodeIds: ["nested-node"],
      swarmParentNodeId: "nested-node"
    };
    context.agents[1].state_json = { swarmLeafId: "nested-child" };
    context.agents.unshift({ ...context.currentAgent!, state_json: { swarmLeafId: "root-leader" } });
    context.currentAgent = nestedLeader;
    context.taskId = nestedLeader.task_id;
    context.config = {
      compiledSwarm: {
        nodes: [
          { id: "root-node", leaderLeafId: "root-leader", workerLeafIds: ["nested-leader"] },
          { id: "nested-node", parentNodeId: "root-node", leaderLeafId: "nested-leader", workerLeafIds: ["nested-child"] }
        ]
      }
    };

    const rootContext = { ...context, taskId: "leader-task", currentAgent: context.agents[0] };
    const rootView = await manageSwarmWorkers({ context: rootContext, start: [], stop: [], grantBudget: [], viewOnly: true });
    expect(rootView.workers.map((worker) => worker.taskId)).toEqual(["worker-task-1"]);

    await expect(manageSwarmWorkers({ context, start: [], stop: [], grantBudget: [], viewOnly: true }))
      .rejects.toThrow("target_swarm");
    await expect(manageSwarmWorkers({ context, targetSwarm: "outer", start: [], stop: [], grantBudget: [], viewOnly: true }))
      .rejects.toThrow("Only an Agent Swarm node leader");
    const view = await manageSwarmWorkers({ context, targetSwarm: "inner", start: [], stop: [], grantBudget: [], viewOnly: true });
    expect(view.workers.map((worker) => worker.taskId)).toEqual(["worker-task-2"]);
    await expect(manageSwarmWorkers({
      context, targetSwarm: "inner", start: ["worker-task-1"], stop: [], grantBudget: [], viewOnly: false
    })).rejects.toThrow("Unknown swarm worker");

    const result = await manageSwarmWorkers({
      context, targetSwarm: "inner", start: ["worker-task-2"], stop: [], grantBudget: [], viewOnly: false
    });
    expect(result.started).toEqual(["Worker 2"]);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "worker-task-2"
    }));
  });

  it("shows paused agents and outstanding dependencies across nested nodes", async () => {
    workflowState = {
      pausedSwarmAgents: {
        "leader-task": {
          status: "Waiting for both reports",
          waitingForTaskIds: ["worker-task-1", "worker-task-2"],
          finishedTaskIds: ["worker-task-1"],
          triggerSource: "web",
          mode: "agent_swarm_leader"
        },
        "worker-task-2": {
          status: "Waiting for leader decision",
          waitingForTaskIds: [],
          finishedTaskIds: [],
          triggerSource: "web",
          mode: "agent_swarm_worker"
        }
      }
    };
    const result = await manageSwarmWorkers({
      context: createContext(), start: [], stop: [], grantBudget: [], viewOnly: true
    });

    expect(result.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "leader-task", paused: true, pauseReason: "Waiting for both reports", waitingForTaskIds: ["worker-task-2"] }),
      expect.objectContaining({ taskId: "worker-task-2", paused: true, stopped: false, waitingForTaskIds: [] })
    ]));
  });
});
