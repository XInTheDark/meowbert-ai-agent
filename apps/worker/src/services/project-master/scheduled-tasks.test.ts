import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../task-schedules/service.js", () => ({
  createRecurringTaskFromTool: vi.fn()
}));

import { query } from "../../lib/db.js";
import { createRecurringTaskFromTool } from "../task-schedules/service.js";
import type { ToolDispatchContext } from "../agent-tool-dispatch/types.js";
import { createScheduledManagedTask } from "./scheduled-tasks.js";

const ctx = {
  taskId: "master-1",
  workspaceId: "workspace-1",
  environmentId: "env-1",
  actorUserId: "user-2",
  triggerSource: "telegram",
  connectorContextId: "thread-1",
  defaultTimezone: "Asia/Singapore",
  runToolOptions: { webSearch: true }
} as unknown as ToolDispatchContext;

const request = {
  taskId: "task-1",
  title: "Morning digest",
  message: "Summarize overnight PRs",
  repeat: "0 9 * * *",
  timezone: null,
  listen: true
};

describe("createScheduledManagedTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
    vi.mocked(createRecurringTaskFromTool).mockResolvedValue({
      taskId: "task-1",
      runId: "run-1",
      mode: "scheduled",
      scheduleState: "active",
      repeat: "0 9 * * *",
      timezone: "Asia/Singapore",
      nextRunAt: "2026-10-01T01:00:00.000Z"
    });
  });

  it("creates a web-owned recurring task for the requesting user that reports to the Master", async () => {
    const result = await createScheduledManagedTask(ctx, request);

    expect(result).toMatchObject({ taskId: "task-1", nextRunAt: "2026-10-01T01:00:00.000Z", reusedExisting: false });
    expect(createRecurringTaskFromTool).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        title: "Morning digest",
        // The chat reply address stays with the Master, never with the scheduled task.
        source: "web",
        connectorContextId: null,
        initiatorUserId: "user-2",
        reportToMasterTaskId: "master-1",
        mode: "scheduled",
        repeat: "0 9 * * *"
      })
    );
  });

  it("does not report to the Master when listening is off", async () => {
    await createScheduledManagedTask(ctx, { ...request, listen: false });

    expect(createRecurringTaskFromTool).toHaveBeenCalledWith(
      expect.objectContaining({ reportToMasterTaskId: null })
    );
  });

  it("reuses the task a replayed tool call already created", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ repeat_cron: "0 9 * * *", timezone: "Asia/Singapore", next_run_at: "2026-10-01T01:00:00.000Z" }],
      rowCount: 1
    } as never);

    const result = await createScheduledManagedTask(ctx, request);

    expect(result).toMatchObject({ taskId: "task-1", reusedExisting: true });
    expect(createRecurringTaskFromTool).not.toHaveBeenCalled();
  });
});
