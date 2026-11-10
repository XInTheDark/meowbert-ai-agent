import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn().mockResolvedValue("note-message"),
  resolveContinuationBranchMessageId: vi.fn().mockResolvedValue("leaf-message"),
  resolveLatestBranchSelectionUserId: vi.fn().mockResolvedValue("user-1")
}));
vi.mock("./shared.js", () => ({ enqueueWorkflowTaskRun: vi.fn().mockResolvedValue({ runId: "run-1", attemptNo: 2 }) }));

import { query, withTransaction } from "../../lib/db.js";
import { appendMessage } from "../agent-db/index.js";
import { enqueueWorkflowTaskRun } from "./shared.js";
import { runClarifyTimeoutSweepOnce } from "./clarify-timeout.js";

function mockTimedOutTask(lockedStatus: string): void {
  vi.mocked(query).mockResolvedValueOnce({
    rows: [{ id: "task-1", workspace_id: "ws-1", environment_id: "env-1" }],
    rowCount: 1
  } as never);
  const client = {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: lockedStatus }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 })
  };
  vi.mocked(withTransaction).mockImplementation(async (callback) => callback(client as never));
}

describe("runClarifyTimeoutSweepOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tells a silent clarify task to proceed and starts its clarify run again", async () => {
    mockTimedOutTask("awaiting_input");

    await expect(runClarifyTimeoutSweepOnce()).resolves.toBe(1);

    expect(appendMessage).toHaveBeenCalledWith("task-1", "user", expect.any(Object), expect.objectContaining({ parentMessageId: "leaf-message" }));
    expect(enqueueWorkflowTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      mode: "long_horizon_clarify",
      branchMessageId: "note-message"
    }));
  });

  it("leaves a task alone when the user replied before the sweep claimed it", async () => {
    mockTimedOutTask("queued");

    await expect(runClarifyTimeoutSweepOnce()).resolves.toBe(0);

    expect(appendMessage).not.toHaveBeenCalled();
    expect(enqueueWorkflowTaskRun).not.toHaveBeenCalled();
  });
});
