import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";

const mocks = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  recordRunCompletion: vi.fn(),
  setTaskBranchSelection: vi.fn(),
  setTaskStatusForRun: vi.fn(),
  emitTaskEvent: vi.fn(),
  scheduleTaskRunRetry: vi.fn(),
  wakeParkedSwarmTaskIfBarrierMet: vi.fn(async () => false)
}));

vi.mock("../agent-db/index.js", () => ({
  appendMessage: mocks.appendMessage,
  recordRunCompletion: mocks.recordRunCompletion,
  setTaskBranchSelection: mocks.setTaskBranchSelection,
  setTaskStatusForRun: mocks.setTaskStatusForRun
}));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: mocks.emitTaskEvent }));
vi.mock("../tasks/task-run-retry.js", () => ({ scheduleTaskRunRetry: mocks.scheduleTaskRunRetry }));
vi.mock("../task-schedules/service.js", () => ({ pauseInfiniteScheduleAfterCheckin: vi.fn() }));
vi.mock("./run-cancellation.js", () => ({ handleCancelledRun: vi.fn() }));
vi.mock("../agent-swarm/run-finalize.js", () => ({ finishFailedLaneRun: vi.fn() }));
vi.mock("../agent-swarm/park.js", () => ({ wakeParkedSwarmTaskIfBarrierMet: mocks.wakeParkedSwarmTaskIfBarrierMet }));

import { failServerRun } from "./run-failure.js";
import { handleCancelledRun } from "./run-cancellation.js";
import { finishFailedLaneRun } from "../agent-swarm/run-finalize.js";

const idleJob: TaskExecutionJob = {
  taskId: "task-1", runId: "run-1", workspaceId: "workspace-1", environmentId: "environment-1",
  triggerSource: "web", mode: "compact_only", contextAction: "idle", restoreStatus: "succeeded"
};
const failure = {
  errorMessage: "502 Rate limit reached",
  retryAfterMs: 5_000,
  persistedItems: [{ role: "developer" as const, content: "idle note" }],
  currentLeafMessageId: "leaf-1",
  agentId: null,
  reasoningContentCount: 0
};

describe("failServerRun for idle compaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the task back its previous status and writes nothing to the conversation", async () => {
    mocks.scheduleTaskRunRetry.mockResolvedValue({ status: "exhausted", errorMessage: failure.errorMessage });
    await failServerRun(idleJob, failure);
    expect(mocks.setTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "succeeded");
    expect(mocks.recordRunCompletion).toHaveBeenCalledWith("run-1", "error", failure.errorMessage);
    expect(mocks.wakeParkedSwarmTaskIfBarrierMet).toHaveBeenCalledWith("task-1");
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("keeps retries out of the conversation", async () => {
    mocks.scheduleTaskRunRetry.mockResolvedValue({ status: "scheduled", retryNotice: "Retrying" });
    await failServerRun(idleJob, failure);
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.setTaskStatusForRun).not.toHaveBeenCalled();
  });

  it("passes Retry-After to the retry scheduler", async () => {
    mocks.scheduleTaskRunRetry.mockResolvedValue({ status: "noop", errorMessage: failure.errorMessage });
    await failServerRun(idleJob, failure);
    expect(mocks.scheduleTaskRunRetry.mock.calls[0][0].error.retryAfterMs).toBe(5_000);
  });
});

describe("failServerRun for other runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still fails the task when retries run out", async () => {
    mocks.scheduleTaskRunRetry.mockResolvedValue({ status: "exhausted", errorMessage: failure.errorMessage });
    mocks.setTaskStatusForRun.mockResolvedValue(true);
    await failServerRun({ ...idleJob, mode: "default", contextAction: undefined, restoreStatus: undefined }, { ...failure, persistedItems: [] });
    expect(mocks.setTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "failed");
    expect(mocks.appendMessage).toHaveBeenCalled();
  });

  it("settles a stopped lane and retains its output when shutdown fails with a provider error", async () => {
    mocks.scheduleTaskRunRetry.mockResolvedValue({ status: "cancelled", errorMessage: failure.errorMessage });
    const laneJob = { ...idleJob, mode: "agent_swarm_lane" as const };
    await failServerRun(laneJob, failure);
    expect(mocks.appendMessage).toHaveBeenCalledWith("task-1", "assistant", {
      text: "", response_items: failure.persistedItems
    }, expect.anything());
    expect(handleCancelledRun).toHaveBeenCalledWith(laneJob);
    expect(finishFailedLaneRun).toHaveBeenCalledWith(laneJob, "cancelled", true);
    expect(mocks.appendMessage.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(handleCancelledRun).mock.invocationCallOrder[0]);
    expect(mocks.setTaskStatusForRun).not.toHaveBeenCalled();
  });
});
