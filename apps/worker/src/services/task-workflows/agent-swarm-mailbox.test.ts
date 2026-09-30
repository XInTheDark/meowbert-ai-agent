import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedWorkflowRunContext } from "./context-types.js";

vi.mock("../../lib/db.js", () => ({
  withTransaction: vi.fn()
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn()
}));

vi.mock("./shared.js", async () => {
  const actual = await vi.importActual<typeof import("./shared.js")>("./shared.js");
  return {
    ...actual,
    enqueueWorkflowTaskRun: vi.fn(),
    getSwarmToolOptionsOverride: vi.fn()
  };
});

import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import {
  maybeResumeSwarmWaitCycle,
  maybeResumeStalledSwarm,
  maybeWakePausedSwarmAgentsAfterMessage,
  pauseSwarmAgent,
  persistSwarmPause,
  removeSwarmPauses,
  clearSwarmPauseOnRunStart
} from "./agent-swarm-mailbox.js";
import { enqueueWorkflowTaskRun } from "./shared.js";

function createContext(taskId = "leader-task"): LoadedWorkflowRunContext {
  const agents: LoadedWorkflowRunContext["agents"] = [
    {
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
    ...[1, 2].map((number) => ({
      id: `worker-agent-${number}`,
      role: "worker" as const,
      slot_index: number - 1,
      task_id: `worker-task-${number}`,
      title: `Worker ${number}`,
      status: "queued",
      task_root_path: `.meowbert/task-runs/worker-task-${number}`,
      last_inbox_refresh_message_no: 0,
      state_json: {}
    }))
  ];
  return {
    workflowTaskId: "leader-task",
    workflowType: "agent_swarm",
    phase: "active",
    config: {},
    taskId,
    taskDir: "/tmp/task",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    currentAgent: agents.find((agent) => agent.task_id === taskId) ?? null,
    agents,
    planContent: null,
    swarm: {
      sharedDir: "/tmp/shared",
      channels: [],
      peerTaskDirs: [],
      globalChannelId: "global-channel",
      latestWorkflowMessageNo: 10,
      leaderGlobalMessageCount: 1,
      activeWorkerCount: 2,
      workerGlobalReportTaskIds: [],
      workerGlobalReportLabels: [],
      missingWorkerGlobalReportTaskIds: ["worker-task-1", "worker-task-2"],
      missingWorkerGlobalReportLabels: ["Worker 1", "Worker 2"],
      workersStartedAt: "2026-08-27T00:00:00.000Z",
      completedReviewRounds: 0,
      finalReview: null
    },
    runtime: {
      lastPassiveRefreshAtMs: 0,
      lastExplicitRefreshWorkflowMessageNo: 10,
      pendingChannelMessageSendAfterRefresh: false
    }
  };
}

function createNestedContext(taskId = "worker-task-1"): LoadedWorkflowRunContext {
  const context = createContext(taskId);
  context.agents[0].state_json = { swarmLeafId: "root-leaf", swarmNodeIds: ["outer-node"] };
  context.agents[1].state_json = {
    swarmLeafId: "inner-leaf", swarmNodeIds: ["inner-node", "outer-node"],
    swarmLeaderNodeIds: ["inner-node"], swarmParentNodeId: "inner-node"
  };
  context.agents[2].state_json = { swarmLeafId: "child-leaf", swarmNodeIds: ["inner-node"] };
  context.config = {
    compiledSwarm: {
      rootNodeId: "outer-node",
      nodes: [
        { id: "outer-node", parentNodeId: null, leaderLeafId: "root-leaf", workerLeafIds: ["inner-leaf"] },
        { id: "inner-node", parentNodeId: "outer-node", leaderLeafId: "inner-leaf", workerLeafIds: ["child-leaf"] }
      ]
    },
    swarmChannelIds: { "outer-node": "global-channel", "inner-node": "inner-channel" }
  };
  return context;
}

function createStatefulClient(initialState: Record<string, unknown>) {
  let state = initialState;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT state_json")) {
        return { rows: [{ state_json: state }], rowCount: 1 };
      }
      if (sql.includes("UPDATE task_workflows") && typeof params?.[1] === "string") {
        state = JSON.parse(params[1]) as Record<string, unknown>;
      }
      return { rows: [], rowCount: 0 };
    })
  };
  return { client, getState: () => state };
}

describe("Agent Swarm mailbox", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedEnqueueWorkflowTaskRun = vi.mocked(enqueueWorkflowTaskRun);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedEnqueueWorkflowTaskRun.mockResolvedValue({ runId: "run-1", attemptNo: 1 });
  });

  it("stores a leader pause with expected reports and discards legacy wait state", async () => {
    const { client, getState } = createStatefulClient({
      pendingSwarmWaits: { stale: {} },
      startedSwarmWorkerTaskIds: ["worker-task-1", "worker-task-2"]
    });

    await persistSwarmPause(client as never, {
      context: createContext(),
      sinceMessageNo: 11,
      channelId: "global-channel",
      triggerSource: "web",
      selectionUserId: null,
      status: "Waiting for worker reports."
    });

    expect(getState()).not.toHaveProperty("pendingSwarmWaits");
    expect(getState()).toMatchObject({
      pausedSwarmAgents: {
        "leader-task": {
          sinceMessageNo: 11,
          status: "Waiting for worker reports.",
          expectedReportTaskIds: ["worker-task-1", "worker-task-2"],
          receivedReportTaskIds: []
        }
      }
    });
  });

  it("waits only for started workers when the leader starts a subset", async () => {
    const { client, getState } = createStatefulClient({
      startedSwarmWorkerTaskIds: ["worker-task-1"]
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await persistSwarmPause(client as never, {
      context: createContext(),
      sinceMessageNo: 11,
      channelId: "global-channel",
      triggerSource: "web",
      selectionUserId: null,
      status: "Waiting for started workers."
    });
    expect(getState()).toMatchObject({
      pausedSwarmAgents: {
        "leader-task": { expectedReportTaskIds: ["worker-task-1"] }
      }
    });

    await maybeWakePausedSwarmAgentsAfterMessage(createContext("worker-task-1"), {
      channelId: "global-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1", "worker-task-2"],
      senderTaskId: "worker-task-1",
      messageNo: 12,
      senderCompletedWork: true
    });
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task",
      mode: "agent_swarm_leader"
    }));
  });

  it("resumes a paused leader only after every expected worker report arrives", async () => {
    const { client } = createStatefulClient({
      pausedSwarmAgents: {
        "leader-task": {
          sinceMessageNo: 10,
          expectedReportTaskIds: ["worker-task-1", "worker-task-2"],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_leader"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await maybeWakePausedSwarmAgentsAfterMessage(createContext("worker-task-1"), {
      channelId: "global-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1", "worker-task-2"],
      senderTaskId: "worker-task-1",
      messageNo: 11,
      senderCompletedWork: false
    });
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();

    await maybeWakePausedSwarmAgentsAfterMessage(createContext("worker-task-1"), {
      channelId: "global-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1", "worker-task-2"],
      senderTaskId: "worker-task-1",
      messageNo: 12,
      senderCompletedWork: true
    });
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();

    await maybeWakePausedSwarmAgentsAfterMessage(createContext("worker-task-2"), {
      channelId: "global-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1", "worker-task-2"],
      senderTaskId: "worker-task-2",
      messageNo: 13,
      senderCompletedWork: true
    });
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task",
      mode: "agent_swarm_leader"
    }));
  });

  it("keeps paused workers asleep when the leader posts to Global", async () => {
    const { client, getState } = createStatefulClient({
      pausedSwarmAgents: {
        "worker-task-1": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await maybeWakePausedSwarmAgentsAfterMessage(createContext(), {
      channelId: "global-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1", "worker-task-2"],
      senderTaskId: "leader-task",
      messageNo: 11,
      senderCompletedWork: false
    });

    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
    expect(getState()).toHaveProperty("pausedSwarmAgents.worker-task-1");
  });

  it("resumes a paused direct-channel recipient at most once", async () => {
    const { client } = createStatefulClient({
      pausedSwarmAgents: {
        "worker-task-1": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    const message = {
      channelId: "direct-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1"],
      senderTaskId: "leader-task",
      messageNo: 11,
      senderCompletedWork: false
    };

    await maybeWakePausedSwarmAgentsAfterMessage(createContext(), message);
    await maybeWakePausedSwarmAgentsAfterMessage(createContext(), message);

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "worker-task-1",
      mode: "agent_swarm_worker"
    }));
    expect(vi.mocked(emitTaskEvent)).toHaveBeenCalledWith(
      "worker-task-1",
      "log",
      expect.objectContaining({ message: expect.stringContaining("resumed") })
    );
    expect(vi.mocked(emitTaskEvent)).toHaveBeenCalledWith(
      "leader-task",
      "log",
      expect.objectContaining({ message: expect.stringContaining("resumed") })
    );
  });

  it("keeps an inner leader paused through outer mail and wakes it on an inner report", async () => {
    const { client, getState } = createStatefulClient({
      startedSwarmWorkerTaskIds: ["worker-task-1", "worker-task-2"]
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    await persistSwarmPause(client as never, {
      context: createNestedContext(), targetSwarm: "inner", sinceMessageNo: 10,
      channelId: "inner-channel", triggerSource: "web", selectionUserId: null,
      status: "Waiting for inner report"
    });
    expect(getState()).toMatchObject({
      pausedSwarmAgents: {
        "worker-task-1": { swarmNodeId: "inner-node", expectedReportTaskIds: ["worker-task-2"] }
      }
    });

    await maybeWakePausedSwarmAgentsAfterMessage(createNestedContext("leader-task"), {
      swarmNodeId: "outer-node", channelId: "outer-direct",
      channelMemberTaskIds: ["leader-task", "worker-task-1"], senderTaskId: "leader-task",
      messageNo: 11, senderCompletedWork: false
    });
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
    expect(getState()).toHaveProperty("pausedSwarmAgents.worker-task-1");

    await maybeWakePausedSwarmAgentsAfterMessage(createNestedContext("worker-task-2"), {
      swarmNodeId: "inner-node", channelId: "inner-channel",
      channelMemberTaskIds: ["worker-task-1", "worker-task-2"], senderTaskId: "worker-task-2",
      messageNo: 12, senderCompletedWork: true
    });
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "worker-task-1", mode: "agent_swarm_worker"
    }));
  });

  it("wakes a dual-role leader from an inner report while it is paused for the outer swarm", async () => {
    const { client, getState } = createStatefulClient({
      startedSwarmWorkerTaskIds: ["worker-task-1", "worker-task-2"],
      pausedSwarmAgents: {
        "worker-task-1": {
          swarmNodeId: "outer-node",
          sinceMessageNo: 10,
          status: "Waiting for outer mail",
          waitingForTaskIds: [],
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await maybeWakePausedSwarmAgentsAfterMessage(createNestedContext("worker-task-2"), {
      swarmNodeId: "inner-node",
      channelId: "inner-channel",
      channelMemberTaskIds: ["worker-task-1", "worker-task-2"],
      senderTaskId: "worker-task-2",
      messageNo: 11,
      senderCompletedWork: true
    });

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "worker-task-1", mode: "agent_swarm_worker"
    }));
    expect(getState()).not.toHaveProperty("pausedSwarmAgents.worker-task-1");
  });

  it("wakes the leader once when a partial worker wait cycle forms", async () => {
    const { client, getState } = createStatefulClient({
      pausedSwarmAgents: {
        "leader-task": {
          sinceMessageNo: 10, status: "Waiting for reports", waitingForTaskIds: [],
          expectedReportTaskIds: ["worker-task-1", "worker-task-2"], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_leader"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await persistSwarmPause(client as never, {
      context: createContext("worker-task-1"), sinceMessageNo: 10, channelId: null,
      triggerSource: "web", selectionUserId: null, status: "Need Worker 2",
      waitingForTaskIds: ["worker-task-2"]
    });
    await maybeResumeSwarmWaitCycle(createContext("worker-task-1"));
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();

    await pauseSwarmAgent({
      context: createContext("worker-task-2"), triggerSource: "web", selectionUserId: null,
      status: "Need Worker 1", waitingForTaskIds: ["worker-task-1"]
    });
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task", mode: "agent_swarm_leader"
    }));
    expect(getState()).not.toHaveProperty("pausedSwarmAgents.leader-task");
    expect(getState()).toHaveProperty("lastSwarmWaitCycleSignature");
    expect(getState()).toHaveProperty("lastSwarmWaitCycleTaskIds", ["worker-task-2", "worker-task-1", "worker-task-2"]);

    await persistSwarmPause(client as never, {
      context: createContext(), sinceMessageNo: 10, channelId: null,
      triggerSource: "web", selectionUserId: null, status: "Still waiting"
    });
    await maybeResumeSwarmWaitCycle(createContext());
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
  });

  it("resumes the inner leader for an inner-only wait cycle", async () => {
    const { client, getState } = createStatefulClient({
      pausedSwarmAgents: {
        "worker-task-1": {
          swarmNodeId: "inner-node", sinceMessageNo: 10, status: "Need inner worker",
          waitingForTaskIds: ["worker-task-2"], expectedReportTaskIds: [], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_worker"
        },
        "worker-task-2": {
          sinceMessageNo: 10, status: "Need inner leader",
          waitingForTaskIds: ["worker-task-1"], expectedReportTaskIds: [], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    await maybeResumeSwarmWaitCycle(createNestedContext("worker-task-2"));
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "worker-task-1", mode: "agent_swarm_worker"
    }));
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task"
    }));
    expect(getState()).not.toHaveProperty("pausedSwarmAgents.worker-task-1");
  });

  it("wakes the leader for a cycle recorded by a message pause", async () => {
    const { client } = createStatefulClient({
      pausedSwarmAgents: {
        "leader-task": {
          sinceMessageNo: 10, expectedReportTaskIds: [], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_leader"
        },
        "worker-task-1": {
          sinceMessageNo: 10, waitingForTaskIds: ["worker-task-2"],
          expectedReportTaskIds: [], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await persistSwarmPause(client as never, {
      context: createContext("worker-task-2"), sinceMessageNo: 11,
      channelId: "direct-channel", triggerSource: "web", selectionUserId: null,
      status: "Paused after sending a swarm message.", waitingForTaskIds: ["worker-task-1"]
    });
    await maybeResumeSwarmWaitCycle(createContext("worker-task-2"));
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: "leader-task" }));
  });

  it("ignores a wait cycle that relevant mail already broke", async () => {
    const { client } = createStatefulClient({
      pausedSwarmAgents: {
        "leader-task": {
          sinceMessageNo: 10, expectedReportTaskIds: [], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_leader"
        },
        "worker-task-1": {
          sinceMessageNo: 10, waitingForTaskIds: ["worker-task-2"],
          expectedReportTaskIds: [], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_worker"
        },
        "worker-task-2": {
          sinceMessageNo: 11, waitingForTaskIds: ["worker-task-1"],
          expectedReportTaskIds: [], receivedReportTaskIds: [],
          triggerSource: "web", selectionUserId: null, mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    await removeSwarmPauses(client as never, "leader-task", ["worker-task-1"]);
    await maybeResumeSwarmWaitCycle(createContext("worker-task-2"));
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("rejects dependencies outside the swarm roster", async () => {
    const { client } = createStatefulClient({});
    await expect(persistSwarmPause(client as never, {
      context: createContext("worker-task-1"), sinceMessageNo: 10, channelId: null,
      triggerSource: "web", selectionUserId: null, status: "Waiting",
      waitingForTaskIds: ["outside-task"]
    })).rejects.toThrow("Unknown swarm wait dependency");
  });

  it("nudges the leader only once for an unchanged all-paused swarm", async () => {
    const createPause = (mode: "agent_swarm_leader" | "agent_swarm_worker") => ({
      sinceMessageNo: 10,
      expectedReportTaskIds: [],
      receivedReportTaskIds: [],
      triggerSource: "web",
      selectionUserId: null,
      mode
    });
    const { client, getState } = createStatefulClient({
      pausedSwarmAgents: {
        "leader-task": createPause("agent_swarm_leader"),
        "worker-task-1": createPause("agent_swarm_worker"),
        "worker-task-2": createPause("agent_swarm_worker")
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    const context = createContext();

    await maybeResumeStalledSwarm(context);
    await persistSwarmPause(client as never, {
      context,
      sinceMessageNo: 10,
      channelId: "global-channel",
      triggerSource: "web",
      selectionUserId: null,
      status: "Waiting for worker reports."
    });
    await maybeResumeStalledSwarm(context);

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task",
      mode: "agent_swarm_leader"
    }));
    expect(getState()).toHaveProperty("lastSwarmStallSignature");
  });

  it("resumes a paused pending nested leader before the root leader", async () => {
    const { client, getState } = createStatefulClient({
      startedSwarmWorkerTaskIds: ["worker-task-1"],
      pausedSwarmAgents: {
        "leader-task": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_leader"
        },
        "worker-task-1": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    const context = createNestedContext();
    context.swarm!.pendingNestedSwarmNodeIds = ["inner-node"];

    await maybeResumeStalledSwarm(context);

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "worker-task-1", mode: "agent_swarm_worker"
    }));
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task"
    }));
    expect(getState()).not.toHaveProperty("pausedSwarmAgents.worker-task-1");
    expect(getState()).toHaveProperty("pausedSwarmAgents.leader-task");
  });

  it("allows a stalled leader to be nudged again after its resumed run pauses", async () => {
    const { client, getState } = createStatefulClient({
      lastSwarmStallSignature: "leader-task:10|worker-task-1:10|worker-task-2:10",
      pausedSwarmAgents: {
        "leader-task": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_leader"
        },
        "worker-task-1": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_worker"
        },
        "worker-task-2": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_worker"
        }
      }
    });
    const taskClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT workflow_type")) {
          return { rows: [{ workflow_type: "agent_swarm", workflow_parent_task_id: null }], rowCount: 1 };
        }
        return client.query(sql, params);
      })
    };
    mockedWithTransaction.mockImplementation(async (callback) => callback(taskClient as never));

    await clearSwarmPauseOnRunStart("leader-task");
    expect(getState()).not.toHaveProperty("pausedSwarmAgents.leader-task");
    expect(getState()).not.toHaveProperty("lastSwarmStallSignature");

    await persistSwarmPause(client as never, {
      context: createContext(),
      sinceMessageNo: 10,
      channelId: "global-channel",
      triggerSource: "web",
      selectionUserId: null,
      status: "Waiting for inner swarm consensus messages."
    });
    await maybeResumeStalledSwarm(createContext());

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task",
      mode: "agent_swarm_leader"
    }));
  });

  it("does not wake swarm agents after the workflow is completed", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT state_json, phase")) {
          return {
            rows: [{
              phase: "completed",
              state_json: {
                pausedSwarmAgents: {
                  "leader-task": {
                    sinceMessageNo: 10,
                    expectedReportTaskIds: [],
                    receivedReportTaskIds: [],
                    triggerSource: "web",
                    selectionUserId: null,
                    mode: "agent_swarm_leader"
                  }
                }
              }
            }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    };
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await maybeResumeStalledSwarm(createContext());

    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("restores the pause state if enqueuing a woken agent fails", async () => {
    const { client, getState } = createStatefulClient({
      pausedSwarmAgents: {
        "worker-task-1": {
          sinceMessageNo: 10,
          expectedReportTaskIds: [],
          receivedReportTaskIds: [],
          triggerSource: "web",
          selectionUserId: null,
          mode: "agent_swarm_worker"
        }
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedEnqueueWorkflowTaskRun.mockRejectedValueOnce(new Error("Redis connection dropped"));

    await maybeWakePausedSwarmAgentsAfterMessage(createContext(), {
      channelId: "direct-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1"],
      senderTaskId: "leader-task",
      messageNo: 11,
      senderCompletedWork: false
    });

    expect(getState()).toMatchObject({
      pausedSwarmAgents: {
        "worker-task-1": expect.objectContaining({
          sinceMessageNo: 10,
          mode: "agent_swarm_worker"
        })
      }
    });
  });

  it("restores the leader pause state if enqueuing a stalled leader fails", async () => {
    const createPause = (mode: "agent_swarm_leader" | "agent_swarm_worker") => ({
      sinceMessageNo: 10,
      expectedReportTaskIds: [],
      receivedReportTaskIds: [],
      triggerSource: "web",
      selectionUserId: null,
      mode
    });
    const { client, getState } = createStatefulClient({
      pausedSwarmAgents: {
        "leader-task": createPause("agent_swarm_leader"),
        "worker-task-1": createPause("agent_swarm_worker")
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedEnqueueWorkflowTaskRun.mockRejectedValueOnce(new Error("Redis queue down"));

    await maybeResumeStalledSwarm(createContext());

    expect(getState()).toMatchObject({
      pausedSwarmAgents: {
        "leader-task": expect.objectContaining({
          sinceMessageNo: 10,
          mode: "agent_swarm_leader"
        })
      }
    });
  });
});
