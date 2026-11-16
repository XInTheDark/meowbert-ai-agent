import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), enqueue: vi.fn(), announce: vi.fn(), claim: vi.fn() }));
vi.mock("../../lib/db.js", () => ({ query: mocks.query, withTransaction: async (run: (client: unknown) => Promise<unknown>) => run({ query: mocks.clientQuery }) }));
vi.mock("../agent-db/index.js", () => ({ resolveContinuationBranchMessageId: async () => "leaf" }));
vi.mock("../subagents/dispatch.js", () => ({ enqueueSubagentRun: mocks.enqueue }));
vi.mock("../task-schedules/service.js", () => ({ resolveContinuationModeForInterruptedTask: async (_id: string, mode: string) => mode }));
vi.mock("./claim.js", () => ({ claimQueuedUserMessages: mocks.claim, announceQueuedMessagesDelivered: mocks.announce }));
import { sendDueScheduledMessages } from "./scheduled-send.js";

describe("scheduled send delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ task_id: "task" }] });
    mocks.clientQuery.mockResolvedValue({ rows: [{ workspace_id: "workspace", environment_id: "project", workflow_type: null }] });
    mocks.claim.mockResolvedValue([{ role: "user", authorUserId: "author", content: { text: "send later", tools: { webSearch: true } }, metadata: {} }]);
  });
  it("appends due messages and dispatches the next run in the same transaction", async () => {
    await sendDueScheduledMessages();
    const insert = mocks.clientQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO task_messages"))!;
    expect(JSON.parse(insert[1][2])).toEqual({ text: "send later", tools: { webSearch: true } });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ query: mocks.clientQuery }), "task", true);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ query: mocks.clientQuery }), expect.objectContaining({
      taskId: "task", branchMessageId: insert[1][0], selectionUserId: "author", mode: "default"
    }));
    expect(mocks.announce).toHaveBeenCalledWith("task");
  });
  it("leaves delivery to the inbox when the task cannot be locked as idle", async () => {
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    await sendDueScheduledMessages();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("does not start another run after messages have already been claimed", async () => {
    mocks.claim.mockResolvedValue([]);
    await sendDueScheduledMessages();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });
});
