import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../tasks/task-history-reader.js", () => ({ readTaskPayloads: vi.fn() }));
vi.mock("./lane-creation.js", () => ({ createCheckLane: vi.fn() }));

import { query } from "../../lib/db.js";
import { readTaskPayloads } from "../tasks/task-history-reader.js";
import { loadBranchUserMessages } from "./check.js";

beforeEach(() => vi.resetAllMocks());

describe("Check lane user requirements", () => {
  it("includes cold original requirements alongside a warm follow-up in branch order", async () => {
    const branch = [
      { id: "original", content_json: { text: "" } },
      { id: "follow-up", content_json: { text: "  Also support CSV export.  " } }
    ];
    vi.mocked(query).mockResolvedValue({ rows: branch, rowCount: branch.length } as never);
    vi.mocked(readTaskPayloads).mockResolvedValue([
      { ...branch[0], content_json: { text: "  Build an offline inventory app.  " } },
      branch[1]
    ]);

    expect(await loadBranchUserMessages("swarm-task", "selected-leaf")).toEqual([
      "Build an offline inventory app.", "Also support CSV export."
    ]);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["swarm-task", "selected-leaf"]);
    expect(readTaskPayloads).toHaveBeenCalledWith("swarm-task", "messages", branch);
  });

  it("omits blank messages after hydration and supports the latest branch", async () => {
    const branch = [
      { id: "empty", content_json: {} },
      { id: "whitespace", content_json: { text: "   " } },
      { id: "requirement", content_json: { text: "Keep all data local." } }
    ];
    vi.mocked(query).mockResolvedValue({ rows: branch, rowCount: branch.length } as never);
    vi.mocked(readTaskPayloads).mockResolvedValue(branch);

    expect(await loadBranchUserMessages("swarm-task", null)).toEqual(["Keep all data local."]);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["swarm-task", null]);
  });

  it("fails if original requirements cannot be hydrated instead of silently dropping them", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: "original", content_json: {} }], rowCount: 1 } as never);
    vi.mocked(readTaskPayloads).mockRejectedValue(new Error("Archive unavailable"));
    await expect(loadBranchUserMessages("swarm-task", null)).rejects.toThrow("Archive unavailable");
  });
});
