import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  appendTaskEvent: vi.fn()
}));

vi.mock("../../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run({ query: mocks.clientQuery }))
}));
vi.mock("../../runtime/events.js", () => ({ appendTaskEvent: mocks.appendTaskEvent }));
vi.mock("../../project-master/reply-contexts.js", () => ({ recordProjectMasterReplyContextInTx: vi.fn() }));

import { queueTaskUserMessageIfRunActive } from "./queued-messages.js";

function rows<Row extends object>(list: Row[]) {
  return { rows: list, rowCount: list.length };
}

function task(overrides: Record<string, unknown> = {}) {
  return { status: "running", cancellation_requested: false, execution_target: { kind: "cloud" }, workflow_internal_role: null, ...overrides };
}

function queue() {
  return queueTaskUserMessageIfRunActive({ taskId: "task-1", userId: "user-1", content: { text: "also check the tests" } });
}

function insertedQueueRows(): unknown[] {
  return mocks.clientQuery.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO task_queued_messages"));
}

describe("queueTaskUserMessageIfRunActive", () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.appendTaskEvent.mockReset();
  });

  it("queues a follow-up for a running conversation run and tells live viewers", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce(rows([task()]))
      .mockResolvedValueOnce(rows([{ run_kind: "default" }]))
      .mockResolvedValueOnce(rows([{ id: "queued-1" }]))
      .mockResolvedValue(rows([]));

    await expect(queue()).resolves.toEqual({ queuedMessageId: "queued-1" });
    expect(insertedQueueRows()).toHaveLength(1);
    expect(mocks.appendTaskEvent).toHaveBeenCalledWith("task-1", "log", expect.objectContaining({ phase: "queued_messages" }));
  });

  it.each([
    ["the task is idle", task({ status: "succeeded" })],
    ["the run is already being stopped", task({ cancellation_requested: true })],
    ["the run executes on a device", task({ execution_target: { kind: "local", deviceId: "d-1", mode: "sandbox" } })],
    ["the task is a swarm lane", task({ workflow_internal_role: "lane" })]
  ])("sends the message the usual way when %s", async (_label, taskRow) => {
    mocks.clientQuery.mockResolvedValueOnce(rows([taskRow])).mockResolvedValue(rows([{ run_kind: "default" }]));

    await expect(queue()).resolves.toBeNull();
    expect(insertedQueueRows()).toHaveLength(0);
  });

  it.each(["compact_only", "memory_synthesis", "long_horizon_reviewer"])("interrupts a %s run as before", async (runKind) => {
    mocks.clientQuery.mockResolvedValueOnce(rows([task()])).mockResolvedValueOnce(rows([{ run_kind: runKind }]));

    await expect(queue()).resolves.toBeNull();
    expect(insertedQueueRows()).toHaveLength(0);
  });
});
