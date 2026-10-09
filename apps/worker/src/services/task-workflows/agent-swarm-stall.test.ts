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

import { query, withTransaction } from "../../lib/db.js";
import { appendMessage, getNewestLeafMessageId } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { clearSwarmStallAfterProgress, maybeResumeStalledSwarm } from "./agent-swarm-stall.js";
import { enqueueWorkflowTaskRun } from "./shared.js";
import {
  createStatefulSwarmClient,
  createSwarmTestContext,
  createSwarmTestPause
} from "./agent-swarm.test-fixtures.js";

describe("Agent Swarm stall recovery", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedEnqueueWorkflowTaskRun = vi.mocked(enqueueWorkflowTaskRun);
  const allPaused = () => ({
    startedSwarmWorkerTaskIds: ["worker-task-1", "worker-task-2"],
    pausedSwarmAgents: {
      "leader-task": { ...createSwarmTestPause("agent_swarm_leader"), status: "Waiting for reviews." },
      "worker-task-1": createSwarmTestPause("agent_swarm_worker"),
      "worker-task-2": createSwarmTestPause("agent_swarm_worker")
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedEnqueueWorkflowTaskRun.mockResolvedValue({ runId: "run-1", attemptNo: 1 });
  });

  it("nudges the leader once, then hands the task back to the user from the leader's run", async () => {
    const { client, getState } = createStatefulSwarmClient(allPaused());
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await expect(maybeResumeStalledSwarm(createSwarmTestContext())).resolves.toBeNull();
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "leader-task",
      mode: "agent_swarm_leader"
    }));

    // The nudged leader pauses again without any other agent having run.
    const state = getState() as { pausedSwarmAgents: Record<string, unknown> };
    state.pausedSwarmAgents["leader-task"] = { ...createSwarmTestPause("agent_swarm_leader"), status: "Still waiting." };
    const escalation = await maybeResumeStalledSwarm(createSwarmTestContext());

    expect(escalation).toContain("The swarm has stalled");
    expect(escalation).toContain("Still waiting.");
    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledTimes(1);
    expect(getState()).toHaveProperty("swarmStall.escalated", true);
    await expect(maybeResumeStalledSwarm(createSwarmTestContext())).resolves.toBeNull();
  });

  it("posts the escalation to the user's task when another agent's run detects it", async () => {
    const { client } = createStatefulSwarmClient({
      ...allPaused(),
      swarmStall: { nudgedTaskId: "leader-task", escalated: false }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    vi.mocked(getNewestLeafMessageId).mockResolvedValue("message-9");
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as never);

    await expect(maybeResumeStalledSwarm(createSwarmTestContext("worker-task-2"))).resolves.toBeNull();

    expect(appendMessage).toHaveBeenCalledWith(
      "leader-task",
      "assistant",
      { text: expect.stringContaining("The swarm has stalled") },
      { parentMessageId: "message-9" }
    );
    expect(vi.mocked(query).mock.calls[0]?.[0]).toContain("status = 'awaiting_input'");
    expect(emitTaskEvent).toHaveBeenCalledWith("leader-task", "status", { status: "awaiting_input" });
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("nudges again after another agent has run", () => {
    const nudged = { swarmStall: { nudgedTaskId: "leader-task", escalated: false } };
    clearSwarmStallAfterProgress(nudged, "leader-task");
    expect(nudged).toHaveProperty("swarmStall");

    clearSwarmStallAfterProgress(nudged, "worker-task-1");
    expect(nudged).not.toHaveProperty("swarmStall");
  });

  it("does nothing while any active agent is still running", async () => {
    const state = allPaused();
    delete (state.pausedSwarmAgents as Record<string, unknown>)["worker-task-2"];
    const { client } = createStatefulSwarmClient(state);
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await expect(maybeResumeStalledSwarm(createSwarmTestContext())).resolves.toBeNull();
    expect(mockedEnqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });

  it("resumes a paused pending nested leader before the root leader", async () => {
    const { client, getState } = createStatefulSwarmClient({
      startedSwarmWorkerTaskIds: ["worker-task-1"],
      pausedSwarmAgents: {
        "leader-task": createSwarmTestPause("agent_swarm_leader"),
        "worker-task-1": createSwarmTestPause("agent_swarm_worker")
      }
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    const context = createSwarmTestContext();
    context.agents[1].state_json = { swarmLeafId: "inner-leaf" };
    context.config = {
      compiledSwarm: {
        rootNodeId: "outer-node",
        nodes: [{ id: "inner-node", parentNodeId: "outer-node", leaderLeafId: "inner-leaf", workerLeafIds: [] }]
      }
    };
    context.swarm!.pendingNestedSwarmNodeIds = ["inner-node"];

    await maybeResumeStalledSwarm(context);

    expect(mockedEnqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: "worker-task-1" }));
    expect(getState()).toHaveProperty("pausedSwarmAgents.leader-task");
  });

  it("restores the leader pause if enqueuing the nudge fails", async () => {
    const { client, getState } = createStatefulSwarmClient(allPaused());
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedEnqueueWorkflowTaskRun.mockRejectedValueOnce(new Error("Redis queue down"));

    await maybeResumeStalledSwarm(createSwarmTestContext());

    expect(getState()).toHaveProperty("pausedSwarmAgents.leader-task.mode", "agent_swarm_leader");
  });
});
