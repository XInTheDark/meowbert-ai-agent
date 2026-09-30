import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  enqueueRun: vi.fn(),
  setTaskBranchSelection: vi.fn(),
  listTaskMessageLineageIds: vi.fn(),
  buildUserMessageContent: vi.fn((input: { message: string; agent?: { id: string } | null }) => ({
    text: input.message,
    ...(input.agent ? { agent: input.agent } : {})
  }))
}));

vi.mock("../../lib/db.js", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction
}));

vi.mock("./task-message-lineage.js", () => ({
  listTaskMessageLineageIds: mocks.listTaskMessageLineageIds
}));

vi.mock("./task-service/index.js", () => ({
  buildUserMessageContent: mocks.buildUserMessageContent,
  enqueueRun: mocks.enqueueRun,
  setTaskBranchSelection: mocks.setTaskBranchSelection
}));

import { createThreadTask } from "./task-threads.js";

function buildRowsResult<Row extends object>(rows: Row[]) {
  return { rows, rowCount: rows.length };
}

describe("createThreadTask", () => {
  const client = { query: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    mocks.withTransaction.mockImplementation(async (callback) => callback(client as never));
    mocks.listTaskMessageLineageIds.mockResolvedValue(["source-assistant"]);
    mocks.enqueueRun.mockResolvedValue({ runId: "run-1", attemptNo: 1 });
    client.query
      .mockResolvedValueOnce(buildRowsResult([{ role: "assistant" }]))
      .mockResolvedValueOnce(buildRowsResult([{
        id: "parent-task",
        workspace_id: "workspace-1",
        environment_id: "project-1",
        default_timezone: "UTC",
        subtask_depth: 0,
        task_root_path: ".meowbert/task-runs/parent-task",
        interactive_canvas_id: null,
        interactive_canvas_intent: null
      }]))
      .mockResolvedValueOnce(buildRowsResult([{
        id: "source-assistant",
        role: "assistant",
        content_json: { text: "Answer" },
        message_metadata_json: null,
        token_usage_json: null,
        source_ref: null,
        author_user_id: null,
        parent_message_id: null,
        edited_from_message_id: null,
        created_at: "2026-09-05T00:00:00.000Z"
      }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "cloned-assistant" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "thread-message" }]));
  });

  it("stores the thread creation agent separately from the parent task", async () => {
    const result = await createThreadTask({
      taskId: "thread-task",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Follow up",
      agent: { id: "agent-2" }
    });

    expect(result).toEqual({
      taskId: "thread-task",
      messageId: "thread-message",
      activeLeafMessageId: "thread-message",
      runId: "run-1",
      attemptNo: 1
    });

    const threadInsert = client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_threads"));
    expect(threadInsert?.[1]).toEqual([
      "thread-task",
      "parent-task",
      "source-assistant",
      null,
      null,
      "agent-2",
      "user-1"
    ]);
  });
});
