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

interface SourceRow {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  parent_message_id: string | null;
}

function sourceRow(row: SourceRow) {
  return {
    message_metadata_json: null,
    token_usage_json: null,
    source_ref: null,
    author_user_id: null,
    edited_from_message_id: null,
    created_at: "2026-09-05T00:00:00.000Z",
    ...row
  };
}

const SOURCE_MESSAGES = [
  sourceRow({ id: "source-user", role: "user", content_json: { text: "Build it" }, parent_message_id: null }),
  sourceRow({ id: "source-step", role: "assistant", content_json: { text: "", response_items: [{ type: "function_call" }] }, parent_message_id: "source-user" }),
  sourceRow({ id: "source-tool", role: "tool", content_json: { tool: "run_shell" }, parent_message_id: "source-step" }),
  sourceRow({ id: "source-assistant", role: "assistant", content_json: { text: "Answer", response_items: [{ type: "reasoning" }] }, parent_message_id: "source-tool" })
];

function createFakeClient(options: {
  outline: string | null;
  executionTarget?: Record<string, unknown>;
  networkDisabled?: boolean;
}) {
  const inserted: Array<{ id: string; role: unknown; content: Record<string, unknown>; parentId: unknown }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO task_messages")) {
      const id = `new-${inserted.length + 1}`;
      // Cloned rows pass every column; the context and user messages hardcode their role.
      const fixedRole = sql.match(/VALUES \(\$1, '(\w+)'/)?.[1];
      inserted.push(fixedRole
        ? { id, role: fixedRole, content: JSON.parse(String(params[1])), parentId: params[params.length - 2] }
        : { id, role: params[1], content: JSON.parse(String(params[2])), parentId: params[7] });
      return buildRowsResult([{ id }]);
    }
    if (sql.includes("SELECT role")) return buildRowsResult([{ role: "assistant" }]);
    if (sql.includes("FROM tasks")) {
      return buildRowsResult([{
        id: "parent-task",
        workspace_id: "workspace-1",
        environment_id: "project-1",
        default_timezone: "UTC",
        subtask_depth: 0,
        task_root_path: ".meowbert/task-runs/parent-task",
        interactive_canvas_id: null,
        interactive_canvas_intent: null,
        execution_target: options.executionTarget ?? { kind: "cloud" },
        network_disabled: options.networkDisabled ?? false
      }]);
    }
    if (sql.includes("id = ANY($2::uuid[])")) return buildRowsResult(SOURCE_MESSAGES);
    if (sql.includes("SELECT DISTINCT ON (s.kind)") && options.outline) {
      return buildRowsResult([{ kind: "outline", payload_json: { markdown: options.outline }, message_id: "source-assistant" }]);
    }
    return buildRowsResult([]);
  });
  return { client: { query }, inserted };
}

describe("createThreadTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTaskMessageLineageIds.mockResolvedValue(SOURCE_MESSAGES.map((message) => message.id));
    mocks.enqueueRun.mockResolvedValue({ runId: "run-1", attemptNo: 1 });
  });

  function useClient(options: {
    outline: string | null;
    executionTarget?: Record<string, unknown>;
    networkDisabled?: boolean;
  }) {
    const fake = createFakeClient(options);
    mocks.withTransaction.mockImplementation(async (callback) => callback(fake.client as never));
    return fake;
  }

  it("stores the thread creation agent separately from the parent task", async () => {
    const fake = useClient({ outline: null });
    const result = await createThreadTask({
      taskId: "thread-task",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Follow up",
      agent: { id: "agent-2" }
    });

    expect(result).toMatchObject({ taskId: "thread-task", runId: "run-1", attemptNo: 1 });
    const threadInsert = fake.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_threads"));
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

  it("by default keeps only user and assistant text, followed by the parent outline", async () => {
    const fake = useClient({ outline: "## Key points\n- [Answer](#message-source-assistant)" });
    const result = await createThreadTask({
      taskId: "thread-task",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Follow up"
    });

    const rows = fake.inserted;
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "system", "user"]);
    expect(rows[1]).toMatchObject({ content: { text: "Answer" }, parentId: "new-1" });
    expect(rows[2].parentId).toBe("new-2");
    expect(rows[2].content.kind).toBe("thread_context");
    expect(String(rows[2].content.text)).toContain("## Key points");
    expect(rows[3].parentId).toBe("new-3");
    expect(result.messageId).toBe("new-4");
  });

  it("clones the whole lineage when full history is requested", async () => {
    const fake = useClient({ outline: "## Key points" });
    await createThreadTask({
      taskId: "thread-task",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Follow up",
      includeFullHistory: true
    });

    expect(fake.inserted.map((row) => row.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(fake.inserted[3].content).toHaveProperty("response_items");
    expect(fake.inserted[4].parentId).toBe("new-4");
  });

  it("defaults cloud threads to read-only and lets callers opt into writable threads", async () => {
    const defaultFake = useClient({ outline: null, networkDisabled: true });
    await createThreadTask({
      taskId: "thread-ro",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Inspect"
    });
    const defaultTaskInsert = defaultFake.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tasks"));
    expect(defaultTaskInsert?.[1]?.slice(-3)).toEqual([true, true, JSON.stringify({ kind: "cloud" })]);

    const writableFake = useClient({ outline: null });
    await createThreadTask({
      taskId: "thread-rw",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Edit files",
      readOnly: false
    });
    const writableTaskInsert = writableFake.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tasks"));
    expect(writableTaskInsert?.[1]?.slice(-3)).toEqual([false, false, JSON.stringify({ kind: "cloud" })]);
  });

  it("inherits host execution target as writable and rejects read-only threads on host mode", async () => {
    const hostTarget = { kind: "local", deviceId: "11111111-1111-4111-8111-111111111111", mode: "host" };
    const hostFake = useClient({ outline: null, executionTarget: hostTarget });
    await createThreadTask({
      taskId: "thread-host",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Review on host"
    });
    const hostTaskInsert = hostFake.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tasks"));
    expect(hostTaskInsert?.[1]?.slice(-3)).toEqual([false, false, JSON.stringify(hostTarget)]);

    useClient({ outline: null, executionTarget: hostTarget });
    await expect(createThreadTask({
      taskId: "thread-host-ro",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Read-only on host",
      readOnly: true
    })).rejects.toThrow("Read-only threads require sandbox mode.");
  });

  it("applies an explicit execution target override when creating a thread", async () => {
    const bridgeTarget = {
      kind: "local" as const,
      deviceId: "11111111-1111-4111-8111-111111111111",
      mode: "sandbox" as const,
      bridge: true
    };
    const bridgeFake = useClient({ outline: null, executionTarget: { kind: "cloud" } });
    await createThreadTask({
      taskId: "thread-bridge",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Run in bridge",
      executionTarget: bridgeTarget
    });
    const bridgeInsert = bridgeFake.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tasks"));
    expect(bridgeInsert?.[1]?.slice(-3)).toEqual([true, false, JSON.stringify(bridgeTarget)]);

    const nonBridgeTarget = {
      kind: "local" as const,
      deviceId: "11111111-1111-4111-8111-111111111111",
      mode: "sandbox" as const
    };
    const nonBridgeFake = useClient({ outline: null, executionTarget: bridgeTarget });
    await createThreadTask({
      taskId: "thread-no-bridge",
      parentTaskId: "parent-task",
      parentMessageId: "source-assistant",
      userId: "user-1",
      message: "Run without bridge",
      executionTarget: nonBridgeTarget
    });
    const nonBridgeInsert = nonBridgeFake.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tasks"));
    expect(nonBridgeInsert?.[1]?.slice(-3)).toEqual([true, false, JSON.stringify(nonBridgeTarget)]);
  });
});
