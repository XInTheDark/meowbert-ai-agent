import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn()
}));

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn(),
  getNewestLeafMessageId: vi.fn()
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
  clearSwarmPauseOnRunStart,
  maybeWakePausedSwarmAgentsAfterMessage,
  pauseSwarmAgent
} from "./agent-swarm-mailbox.js";
import { enqueueWorkflowTaskRun } from "./shared.js";
import {
  createStatefulSwarmClient,
  createSwarmTestContext,
  createSwarmTestPause
} from "./agent-swarm.test-fixtures.js";

describe("Agent Swarm mailbox", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedEnqueueWorkflowTaskRun = vi.mocked(enqueueWorkflowTaskRun);
  const pause = (context: ReturnType<typeof createSwarmTestContext>, waitingForTaskIds: string[] | null) => pauseSwarmAgent({
    context,
    triggerSource: "web",
    selectionUserId: null,
    status: "Waiting.",
    waitingForTaskIds
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedEnqueueWorkflowTaskRun.mockResolvedValue({ runId: "run-1", attemptNo: 1 });
  });

  it("rejects waiting on a paused worker, because nothing would wake it", async () => {
    const initialState = { pausedSwarmAgents: { "worker-task-1": createSwarmTestPause("agent_swarm_worker") } };
    const { client, getState } = createStatefulSwarmClient(initialState, ["worker-task-2"]);
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await expect(pause(createSwarmTestContext(), ["worker-task-1"]))
      .rejects.toThrow("Worker 1 is not running, so waiting would stall the swarm. Assign it work with assign_worker");
    expect(getState()).toBe(initialState);
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("rejects waiting on a worker that has no live run", async () => {
    const { client } = createStatefulSwarmClient({}, []);
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await expect(pause(createSwarmTestContext(), ["worker-task-2"])).rejects.toThrow("Worker 2 is not running");
  });

  it("rejects dependencies outside the swarm roster", async () => {
    const { client } = createStatefulSwarmClient({}, []);
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await expect(pause(createSwarmTestContext(), ["stranger"])).rejects.toThrow("Unknown swarm wait dependency");
  });

  it("resumes a waiting leader only after every worker it waits for has finished", async () => {
    const { client, getState } = createStatefulSwarmClient(
      { startedSwarmWorkerTaskIds: ["worker-task-1", "worker-task-2"] },
      ["worker-task-1", "worker-task-2"]
    );
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await pause(createSwarmTestContext(), ["worker-task-1", "worker-task-2"]);
    await pause(createSwarmTestContext("worker-task-1"), null);
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
    expect(getState()).toHaveProperty("pausedSwarmAgents.leader-task.finishedTaskIds", ["worker-task-1"]);

    await pause(createSwarmTestContext("worker-task-2"), null);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task",
      mode: "agent_swarm_leader"
    }));
    expect(getState()).not.toHaveProperty("pausedSwarmAgents.leader-task");
  });

  it("lets a worker wait on the leader that its own pause wakes", async () => {
    const { client, getState } = createStatefulSwarmClient(
      { startedSwarmWorkerTaskIds: ["worker-task-1"] },
      ["worker-task-1"]
    );
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await pause(createSwarmTestContext(), ["worker-task-1"]);
    await expect(pause(createSwarmTestContext("worker-task-1"), ["leader-task"])).resolves.toEqual({ escalation: null });

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: "leader-task" }));
    expect(getState()).toHaveProperty("pausedSwarmAgents.worker-task-1.waitingForTaskIds", ["leader-task"]);
  });

  it("wakes a leader waiting on no one when one of its workers finishes", async () => {
    const { client } = createStatefulSwarmClient({ startedSwarmWorkerTaskIds: ["worker-task-1", "worker-task-2"] });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await pause(createSwarmTestContext(), null);
    await pause(createSwarmTestContext("worker-task-2"), null);

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: "leader-task" }));
  });

  it("keeps paused workers asleep when the leader posts to Global", async () => {
    const { client, getState } = createStatefulSwarmClient({
      pausedSwarmAgents: { "worker-task-1": createSwarmTestPause("agent_swarm_worker") }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await maybeWakePausedSwarmAgentsAfterMessage(createSwarmTestContext(), {
      channelId: "global-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1", "worker-task-2"],
      senderTaskId: "leader-task",
      messageNo: 11
    });

    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
    expect(getState()).toHaveProperty("pausedSwarmAgents.worker-task-1");
  });

  it("resumes a paused direct-channel recipient at most once", async () => {
    const { client } = createStatefulSwarmClient({
      pausedSwarmAgents: { "worker-task-1": createSwarmTestPause("agent_swarm_worker") }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    const message = {
      channelId: "direct-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1"],
      senderTaskId: "leader-task",
      messageNo: 11
    };

    await maybeWakePausedSwarmAgentsAfterMessage(createSwarmTestContext(), message);
    await maybeWakePausedSwarmAgentsAfterMessage(createSwarmTestContext(), message);

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
  });

  it("does not wake swarm agents after the workflow is completed", async () => {
    const { client, completeWorkflow } = createStatefulSwarmClient({
      pausedSwarmAgents: { "worker-task-1": createSwarmTestPause("agent_swarm_worker") }
    });
    completeWorkflow();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await maybeWakePausedSwarmAgentsAfterMessage(createSwarmTestContext(), {
      channelId: "direct-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1"],
      senderTaskId: "leader-task",
      messageNo: 11
    });

    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("restores the pause state if enqueuing a woken agent fails", async () => {
    const { client, getState } = createStatefulSwarmClient({
      pausedSwarmAgents: { "worker-task-1": createSwarmTestPause("agent_swarm_worker") }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedEnqueueWorkflowTaskRun.mockRejectedValueOnce(new Error("Redis connection dropped"));

    await maybeWakePausedSwarmAgentsAfterMessage(createSwarmTestContext(), {
      channelId: "direct-channel",
      channelMemberTaskIds: ["leader-task", "worker-task-1"],
      senderTaskId: "leader-task",
      messageNo: 11
    });

    expect(getState()).toMatchObject({
      pausedSwarmAgents: {
        "worker-task-1": expect.objectContaining({ sinceMessageNo: 10, mode: "agent_swarm_worker" })
      }
    });
  });

  it("clears an agent's pause when its run starts", async () => {
    const { client, getState } = createStatefulSwarmClient({
      pausedSwarmAgents: { "worker-task-1": createSwarmTestPause("agent_swarm_worker") }
    });
    client.query.mockImplementationOnce(async () => ({
      rows: [{ workflow_type: "agent_swarm", workflow_parent_task_id: "leader-task" }],
      rowCount: 1
    }) as never);
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await clearSwarmPauseOnRunStart("worker-task-1");

    expect(getState()).not.toHaveProperty("pausedSwarmAgents.worker-task-1");
  });
});
