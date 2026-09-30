import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ withTransaction: vi.fn() }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));
import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import { completeTaskRun } from "./complete-task-run.js";

const input = {taskId: "task", runId: "run", finalResponse: "Done", notificationRequested: true, isSubtask: false, connectorContextId: "thread"};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(emitTaskEvent).mockResolvedValue(undefined); });

it("commits completion and delivery intent before publishing status", async () => {
  let committed = false;
  const query = vi.fn().mockResolvedValue({rowCount: 1});
  vi.mocked(withTransaction).mockImplementation(async (fn) => {
    const result = await fn({query} as never);
    committed = true;
    return result;
  });
  vi.mocked(emitTaskEvent).mockImplementation(async () => { expect(committed).toBe(true); });
  expect(await completeTaskRun(input)).toBe(true);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO task_run_deliveries"), ["run", "task", JSON.stringify(input)]);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE task_runs"), ["run", true, "task"]);
});

it("propagates an outbox failure through the transaction without publishing success", async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("INSERT INTO task_run_deliveries")) throw new Error("write failed");
    return {rowCount: 1};
  });
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn({query} as never));
  await expect(completeTaskRun(input)).rejects.toThrow("write failed");
  expect(emitTaskEvent).not.toHaveBeenCalled();
});

it("does not schedule duplicate delivery for an already-completed or superseded run", async () => {
  const query = vi.fn().mockResolvedValue({rowCount: 0});
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn({query} as never));
  expect(await completeTaskRun(input)).toBe(false);
  expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO task_run_deliveries"))).toBe(false);
  expect(emitTaskEvent).not.toHaveBeenCalled();
});

it("closes an obsolete run without completing or notifying the newer attempt", async () => {
  const query = vi.fn().mockResolvedValue({rowCount: 1}).mockResolvedValueOnce({rowCount: 0});
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn({query} as never));
  expect(await completeTaskRun(input)).toBe(false);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE task_runs"), ["run", false, "task"]);
  expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO task_run_deliveries"))).toBe(false);
});
