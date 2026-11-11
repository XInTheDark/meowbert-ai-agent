import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("./messages.js", () => ({
  getNewestLeafMessageId: vi.fn(),
  resolveNewestDescendantLeafMessageId: vi.fn()
}));

import { query } from "../../lib/db.js";
import { getNewestLeafMessageId, resolveNewestDescendantLeafMessageId } from "./messages.js";
import { resolveContinuationBranchMessageId, resolveRunBranchMessageId } from "./branches.js";

describe("resolveContinuationBranchMessageId", () => {
  const mockedQuery = vi.mocked(query);
  const mockedGetNewestLeafMessageId = vi.mocked(getNewestLeafMessageId);
  const mockedResolveNewestDescendantLeafMessageId = vi.mocked(resolveNewestDescendantLeafMessageId);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues the selected branch leaf instead of creating a sibling from its user message", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ active_leaf_message_id: "stale-selected-leaf" }],
      rowCount: 1
    } as never);
    mockedResolveNewestDescendantLeafMessageId.mockResolvedValueOnce("current-tool-leaf");

    await expect(resolveContinuationBranchMessageId("task-1", "user-1")).resolves.toBe("current-tool-leaf");

    expect(mockedResolveNewestDescendantLeafMessageId).toHaveBeenCalledWith("task-1", "stale-selected-leaf");
    expect(mockedGetNewestLeafMessageId).not.toHaveBeenCalled();
  });

  it("uses the newest task leaf only when no selected branch can be resolved", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    mockedGetNewestLeafMessageId.mockResolvedValueOnce("newest-task-leaf");

    await expect(resolveContinuationBranchMessageId("task-1", "user-1")).resolves.toBe("newest-task-leaf");
  });
});

describe("resolveRunBranchMessageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues a retry after what the failed attempt left on its branch", async () => {
    vi.mocked(resolveNewestDescendantLeafMessageId).mockResolvedValueOnce("failed-attempt-leaf");
    await expect(resolveRunBranchMessageId({ taskId: "task", branchMessageId: "user-message", continueBranch: true }))
      .resolves.toBe("failed-attempt-leaf");
  });

  it("starts other runs at the branch message they were given", async () => {
    await expect(resolveRunBranchMessageId({ taskId: "task", branchMessageId: "user-message" }))
      .resolves.toBe("user-message");
    expect(resolveNewestDescendantLeafMessageId).not.toHaveBeenCalled();
  });
});
