import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./dispatch.js", () => ({ enqueueSubagentRun: vi.fn() }));
import { query, withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "./dispatch.js";
import { wakeSubagentsOnce } from "./wait.js";

beforeEach(() => vi.clearAllMocks());

it.each([
  { status: "cancelled", cancellation_requested: true },
  { status: "running", cancellation_requested: true }
])("does not resurrect a subagent stopped after wake candidates were selected: %j", async (task) => {
  vi.mocked(query).mockResolvedValue({ rows: [{ id: "child" }] } as never);
  const txQuery = vi.fn().mockResolvedValue({ rows: [task] });
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query: txQuery } as never));
  await wakeSubagentsOnce();
  expect(enqueueSubagentRun).not.toHaveBeenCalled();
  expect(txQuery).toHaveBeenCalledOnce();
});

it("still wakes an eligible child with undelivered wake mail", async () => {
  vi.mocked(query).mockResolvedValue({ rows: [{ id: "child" }] } as never);
  const txQuery = vi.fn().mockResolvedValueOnce({ rows: [{ workspace_id: "workspace", environment_id: "project",
    initiator_user_id: "user", status: "succeeded", cancellation_requested: false }] })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "mail" }], rowCount: 1 }).mockResolvedValue({ rows: [] });
  vi.mocked(withTransaction).mockImplementation(async (run) => run({ query: txQuery } as never));
  await wakeSubagentsOnce();
  expect(enqueueSubagentRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: "child", selectionUserId: "user" }));
});
