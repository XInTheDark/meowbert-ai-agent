import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../../lib/queue.js", () => ({ taskQueue: { add: vi.fn() } }));
vi.mock("../tasks/task-run-dispatch.js", () => ({ insertTaskRunDispatchWithClient: vi.fn() }));
import { prepareRunWithClient } from "./shared.js";
import { insertTaskRunDispatchWithClient } from "../tasks/task-run-dispatch.js";
beforeEach(() => vi.clearAllMocks());

it.each(["sandbox", "host"] as const)("keeps recurring %s runs on their persisted device and out of the cloud queue", async (mode) => {
  const target = { kind: "local", deviceId: "device", mode };
  const query = vi.fn(async (sql: string) => ({ rowCount: 1, rows: sql.includes("FROM tasks") ? [{ id: "task", initiator_user_id: "owner", execution_target: target }] : [{ attempt_no: 2 }] }));
  const result = await prepareRunWithClient({ query } as never, { taskId: "task", workspaceId: "workspace", environmentId: "project", source: "web", mode: "scheduled_auto" });
  expect(result.schedulerManaged).toBe(true);
  expect(result.payload.executionTarget).toEqual(target);
  expect(insertTaskRunDispatchWithClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ payload: expect.objectContaining({ executionTarget: target }) }));
});

it("refuses a recurring local run with subagents before inserting the run", async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ execution_target: { kind: "local", mode: "host", deviceId: "device" } }] });
  await expect(prepareRunWithClient({ query } as never, { taskId: "task", workspaceId: "workspace", environmentId: "project", source: "web", mode: "scheduled_auto", toolOptionsOverride: { subtasks: true } })).rejects.toThrow("Subagents");
  expect(query).toHaveBeenCalledOnce();
  expect(insertTaskRunDispatchWithClient).not.toHaveBeenCalled();
});
