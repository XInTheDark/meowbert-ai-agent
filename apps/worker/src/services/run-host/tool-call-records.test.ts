import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { query } from "../../lib/db.js";
import { clearInterruptedToolCalls, listUnfinishedToolCalls } from "./tool-call-records.js";
beforeEach(() => vi.resetAllMocks());

it("reports and resolves unfinished calls from an earlier lease of the same run", async () => {
  const calls = [{ run: "reclaimed-run", task: "task", call_id: "interrupted", name: "run_shell", arguments: "side effect" },
    { run: "old-run", task: "task", call_id: "older", name: "run_shell", arguments: "older effect" },
    { run: "other", task: "foreign", call_id: "interrupted", name: "run_shell", arguments: "foreign" }];
  vi.mocked(query).mockImplementation(async (sql, params) => {
    if (sql.startsWith("DELETE")) {
      const ids = params?.[1] as string[];
      for (let i = calls.length - 1; i >= 0; i--) if (calls[i].task === params?.[0] && ids.includes(calls[i].call_id)) calls.splice(i, 1);
      return { rows: [] } as never;
    }
    return { rows: calls.filter((call) => call.task === params?.[0] && (!sql.includes("run_id <>") || call.run !== params?.[1])) } as never;
  });
  expect(await listUnfinishedToolCalls("task")).toEqual([
    { callId: "interrupted", name: "run_shell", arguments: "side effect" },
    { callId: "older", name: "run_shell", arguments: "older effect" }
  ]);
  await clearInterruptedToolCalls("task", ["interrupted"]);
  expect(calls.map((call) => call.task + ":" + call.call_id)).toEqual(["task:older", "foreign:interrupted"]);
});
