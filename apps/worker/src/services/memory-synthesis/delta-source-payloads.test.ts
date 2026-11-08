import { expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../tasks/task-history-reader.js", () => ({ readTaskPayloads: vi.fn() }));
import { query } from "../../lib/db.js";
import { readTaskPayloads } from "../tasks/task-history-reader.js";
import { loadDelta } from "./delta-source.js";

it("restores archived conversation evidence without changing source IDs or delta ordering", async () => {
  const rows = ["a", "b", "a"].map((taskId, index) => ({
    id: `message-${index}`, message_id: `message-${index}`, task_id: taskId,
    role: index === 1 ? "assistant" : "user", text: "", content_json: {}, created_at: `time-${index}`, task_title: taskId
  }));
  vi.mocked(query).mockResolvedValue({ rows } as never);
  vi.mocked(readTaskPayloads).mockImplementation(async (_taskId, _kind, records) => records.map((row) => ({
    ...row, content_json: { text: `restored ${(row as { id: string }).id}` }
  })));
  const delta = await loadDelta({ environmentId: "project", sourceAfter: null });
  expect(delta).toEqual(rows.map(({ id, content_json, ...row }) => ({ ...row, text: `restored ${id}` })));
  expect(readTaskPayloads).toHaveBeenCalledTimes(2);
});
