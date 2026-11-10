import { expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { query } from "../../lib/db.js";
import { loadAgentSwarmView } from "./lanes-read.js";

it("advertises failed lanes for resume with the same expiry rules as submitted lanes", async () => {
  const lane = { task_id: "failed", parent_task_id: "leader", fork_seed_id: "seed", depth: 1,
    kind: "split", title: "Research", status: "failed", steps: 3, spent_tokens: "20",
    merged_at: "2026-11-10T00:00:00Z", user_turns_since_merge: 1 };
  vi.mocked(query)
    .mockResolvedValueOnce({ rows: [{ config_json: { advanced: { dormantLaneTurns: 1 } }, token_budget: null, spent_tokens: "20", deadline_at: null }] } as never)
    .mockResolvedValueOnce({ rows: [lane,
      { ...lane, task_id: "expired", user_turns_since_merge: 2 },
      { ...lane, task_id: "unmerged", merged_at: null },
      { ...lane, task_id: "stopped", status: "stopped" },
      { ...lane, task_id: "reviewer", kind: "check" }
    ] } as never);
  const view = await loadAgentSwarmView("leader");
  expect(view?.lanes.map(({ id, resumable }) => ({ id, resumable }))).toEqual([
    { id: "failed", resumable: true },
    { id: "expired", resumable: false },
    { id: "unmerged", resumable: false },
    { id: "stopped", resumable: false },
    { id: "reviewer", resumable: false }
  ]);
});
