import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agent-swarm-messaging.js", () => ({ sendSwarmChannelMessage: vi.fn() }));
vi.mock("./agent-swarm-mailbox.js", () => ({ pauseSwarmAgent: vi.fn() }));
vi.mock("./agent-swarm-management.js", async () => {
  const actual = await vi.importActual<typeof import("./agent-swarm-management.js")>("./agent-swarm-management.js");
  return { resolveWorkerIds: actual.resolveWorkerIds, manageSwarmWorkers: vi.fn() };
});

import { assignSwarmWorkers } from "./agent-swarm-assignments.js";
import { manageSwarmWorkers } from "./agent-swarm-management.js";
import { pauseSwarmAgent } from "./agent-swarm-mailbox.js";
import { sendSwarmChannelMessage } from "./agent-swarm-messaging.js";
import { createSwarmTestContext } from "./agent-swarm.test-fixtures.js";

describe("assignSwarmWorkers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendSwarmChannelMessage).mockResolvedValue({ messageNo: 12, createdAt: "2026-10-09T00:00:00.000Z" });
    vi.mocked(manageSwarmWorkers).mockResolvedValue({ started: ["Worker 2"], stopped: [], granted: [], workers: [], agents: [] });
    vi.mocked(pauseSwarmAgent).mockResolvedValue({ escalation: null });
  });

  it("posts the assignment, starts the named workers, and waits for exactly them", async () => {
    const context = createSwarmTestContext();

    const result = await assignSwarmWorkers({
      context,
      workers: ["worker 2"],
      message: "Check the arithmetic independently.",
      wait: true,
      triggerSource: "web",
      selectionUserId: null
    });

    expect(sendSwarmChannelMessage).toHaveBeenCalledWith(context, {
      targetSwarm: undefined,
      channelId: "global-channel",
      message: "To Worker 2:\n\nCheck the arithmetic independently."
    });
    expect(manageSwarmWorkers).toHaveBeenCalledWith(expect.objectContaining({ start: ["worker-task-2"], viewOnly: false }));
    expect(pauseSwarmAgent).toHaveBeenCalledWith(expect.objectContaining({ waitingForTaskIds: ["worker-task-2"] }));
    expect(result).toEqual({ messageNo: 12, assigned: ["Worker 2"], started: ["Worker 2"], paused: true, escalation: null });
  });

  it("keeps the leader running without wait and rejects workers outside its node", async () => {
    const context = createSwarmTestContext();

    await assignSwarmWorkers({
      context, workers: ["Worker 1"], message: "Draft a plan.", wait: false, triggerSource: "web", selectionUserId: null
    });
    expect(pauseSwarmAgent).not.toHaveBeenCalled();

    await expect(assignSwarmWorkers({
      context, workers: ["Leader"], message: "Do it.", wait: false, triggerSource: "web", selectionUserId: null
    })).rejects.toThrow("Unknown swarm worker");
  });

  it("is only available to a node leader", async () => {
    await expect(assignSwarmWorkers({
      context: createSwarmTestContext("worker-task-1"),
      workers: ["Worker 2"],
      message: "Help.",
      wait: false,
      triggerSource: "web",
      selectionUserId: null
    })).rejects.toThrow("Only an Agent Swarm node leader");
  });
});
