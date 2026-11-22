import { describe, expect, it } from "vitest";
import { toLaneListing, type ListedLaneRow } from "./lane-listing.js";

function row(taskId: string, parentTaskId: string, overrides: Partial<ListedLaneRow> = {}): ListedLaneRow {
  return {
    task_id: taskId, parent_task_id: parentTaskId, kind: "split", title: taskId, direction: null, status: "done",
    steps: 3, spent_tokens: "1200", result_json: { summary: `${taskId} summary`, decisions: null, findings: null,
      files: [{ path: `${taskId}/out.md`, bytes: 10 }] },
    merged_at: "2026-11-01T00:00:00Z", user_turns: 0, ...overrides
  };
}

describe("list_lanes listing", () => {
  it("lists every owned lane in any status, each right after its parent", () => {
    const rows = [
      row("a", "leader"),
      row("b", "leader", { status: "stopped" }),
      row("a1", "a", { status: "expired" }),
      row("c", "leader", { status: "running", result_json: null, merged_at: null })
    ];
    const listing = toLaneListing(rows, "leader", 2);

    expect(listing.map((lane) => [lane.lane_id, lane.parent_lane_id, lane.status])).toEqual([
      ["a", null, "done"],
      ["a1", "a", "expired"],
      ["b", null, "stopped"],
      ["c", null, "running"]
    ]);
    expect(listing[0]).toMatchObject({ spent_tokens: 1200, summary: "a summary", files: ["a/out.md"] });
    expect(listing[3]).toMatchObject({ summary: null, files: [] });
  });

  it("marks only the owner's own dormant lanes inside the window as resumable", () => {
    const listing = toLaneListing([
      row("fresh", "leader", { user_turns: 1 }),
      row("failed", "leader", { status: "failed" }),
      row("past", "leader", { user_turns: 3 }),
      row("unmerged", "leader", { merged_at: null }),
      row("review", "leader", { kind: "check" }),
      row("stopped", "leader", { status: "stopped" }),
      row("grandchild", "fresh")
    ], "leader", 2);

    expect(Object.fromEntries(listing.map((lane) => [lane.lane_id, lane.resumable]))).toEqual({
      fresh: true, grandchild: false, failed: true, past: false, unmerged: false, review: false, stopped: false
    });
    expect(toLaneListing([row("fresh", "leader")], "leader", 0)[0]?.resumable).toBe(false);
  });
});
