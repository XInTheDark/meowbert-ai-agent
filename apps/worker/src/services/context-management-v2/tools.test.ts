import { describe, expect, it, vi } from "vitest";
import type { ContextManagementV2State } from "./types.js";

const mocks = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  accessibleNodesCte: vi.fn((startIndex: number) => `WITH context_lineage AS (SELECT $${startIndex} AS id)`),
  writeContextNote: vi.fn()
}));

vi.mock("../../lib/db.js", () => ({ query: mocks.query }));
vi.mock("./service.js", () => ({
  accessibleNodesCte: mocks.accessibleNodesCte,
  writeContextNote: mocks.writeContextNote
}));

import { listContextWindows } from "./tools.js";

const state: ContextManagementV2State = {
  version: "v2",
  taskId: "task-1",
  firstWindowId: "window-1",
  windowId: "window-2",
  contextNodeId: "node-2",
  previousWindowId: "window-1",
  branchLeafMessageId: "message-1",
  reminderSent: false,
  pendingReset: false,
  recoveryPhase: "normal"
};

describe("Context Management V2 history tools", () => {
  it("binds the window limit after the context node parameter", async () => {
    await listContextWindows(state, { limit: 7, recent_first: true });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT $3"),
      ["task-1", "node-2", 7]
    );
  });
});
