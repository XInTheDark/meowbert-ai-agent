import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../tasks/task-history-reader.js", () => ({ readTaskPayloads: vi.fn(async (_taskId, _kind, rows) => rows) }));
import { query } from "../../lib/db.js";
import { readTaskPayloads } from "../tasks/task-history-reader.js";
import { readTaskEvidence } from "./evidence.js";

const taskId = "10000000-0000-4000-8000-000000000001";
const messageId = "10000000-0000-4000-8000-000000000002";
const input = { task_id: taskId, message_id: null, before_message_id: null, offset_chars: null };
const row = { id: messageId, role: "tool", parent_message_id: null, created_at: "2026-11-08T00:00:00.000Z",
  content_json: { tool: "run_shell", response_function_output: { call_id: "call-1", output: "tests passed" } } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(query).mockResolvedValue({ rows: [{ id: taskId }] } as never);
});

describe("Memory evidence", () => {
  it("returns source identities and recorded tool output, with bounded backward pagination", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ ...row, id: `${messageId}-${index}` }));
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: taskId }] } as never).mockResolvedValueOnce({ rows } as never);
    const result = await readTaskEvidence(input, "project");
    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({ message_id: rows[0].id, role: "tool", parent_message_id: null });
    expect(JSON.parse(result.items[0].content)).toEqual(row.content_json);
    expect(result.next_before_message_id).toBe(rows[4].id);
    expect(readTaskPayloads).toHaveBeenCalledWith(taskId, "messages", rows.slice(0, 5));
  });

  it("hydrates cold source payloads and pages long exact messages without losing evidence", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: taskId }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: messageId }] } as never).mockResolvedValueOnce({ rows: [row] } as never);
    vi.mocked(readTaskPayloads).mockResolvedValueOnce([{ ...row, role: "assistant", content_json: { text: "a".repeat(9_000) } }]);
    const result = await readTaskEvidence({ ...input, message_id: messageId, offset_chars: 4_000 }, "project");
    expect(result.items[0]).toMatchObject({ content: "a".repeat(4_000), offset_chars: 4_000, next_offset_chars: 8_000 });
    expect(result.next_before_message_id).toBeNull();
  });

  it("does not read source messages when the task is inaccessible", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    await expect(readTaskEvidence(input, "project")).rejects.toThrow("not accessible");
    expect(query).toHaveBeenCalledTimes(1);
    expect(readTaskPayloads).not.toHaveBeenCalled();
  });

  it("rejects a message cursor belonging to another task", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: taskId }] } as never).mockResolvedValueOnce({ rows: [] } as never);
    await expect(readTaskEvidence({ ...input, before_message_id: messageId }, "project")).rejects.toThrow("not found in this task");
    expect(readTaskPayloads).not.toHaveBeenCalled();
  });

  it("validates exact-message offsets and mutually exclusive cursors before querying", async () => {
    await expect(readTaskEvidence({ ...input, offset_chars: 4_000 }, "project")).rejects.toThrow("offset needs");
    await expect(readTaskEvidence({ ...input, message_id: messageId, before_message_id: messageId }, "project")).rejects.toThrow("not both");
    expect(query).not.toHaveBeenCalled();
  });
});
