import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";

vi.mock("../../project-master/api-client.js", () => ({
  cancelManagedTask: vi.fn(),
  createManagedTask: vi.fn(),
  deriveManagedTaskId: vi.fn(() => "10000000-0000-4000-8000-000000000001"),
  messageManagedTask: vi.fn()
}));
vi.mock("../../project-master/listeners.js", () => ({ listenToNewTask: vi.fn(), setTaskListening: vi.fn() }));
vi.mock("../../project-master/scheduled-tasks.js", () => ({ createScheduledManagedTask: vi.fn() }));
vi.mock("../events.js", () => ({
  startBuiltinToolExecution: vi.fn(async () => ({})),
  finishBuiltinToolSuccess: vi.fn(),
  finishBuiltinToolFailure: vi.fn()
}));

import { createScheduledManagedTask } from "../../project-master/scheduled-tasks.js";
import { finishBuiltinToolSuccess } from "../events.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { handleProjectMasterTool } from "./project-master.js";

const ctx = {
  taskId: "master-1",
  runId: "run-1",
  environmentId: "env-1",
  isProjectMaster: true,
  assertNotCancelled: vi.fn()
} as unknown as ToolDispatchContext;

function createTaskCall(args: Record<string, unknown>): ResponseFunctionToolCall {
  return { type: "function_call", call_id: "call-1", name: "create_task", arguments: JSON.stringify(args) };
}

describe("Master create_task with repeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createScheduledManagedTask).mockResolvedValue({
      taskId: "10000000-0000-4000-8000-000000000001",
      repeat: "0 9 * * 1",
      timezone: "Asia/Singapore",
      nextRunAt: "2026-10-05T01:00:00.000Z",
      reusedExisting: false
    });
  });

  // The first run starts at creation, so the next cron time must not read as the first run.
  it("tells the Master the first run already started and when the next scheduled run is", async () => {
    await handleProjectMasterTool(
      createTaskCall({ message: "Review the proposal", title: null, repeat: "0 9 * * 1", timezone: "Asia/Singapore", listen: null }),
      ctx,
      {} as ToolDispatchState
    );

    const output = vi.mocked(finishBuiltinToolSuccess).mock.calls[0]?.[3];
    expect(output).toMatchObject({ first_run: "started_now", next_scheduled_run_at: "2026-10-05T01:00:00.000Z" });
    expect(output).not.toHaveProperty("next_run_at");
  });
});
