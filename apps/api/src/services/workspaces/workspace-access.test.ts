import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));

import { query } from "../../lib/db.js";
import { assertTaskMember } from "./workspace-access.js";

beforeEach(() => vi.resetAllMocks());

describe("assertTaskMember", () => {
  it("returns the task's workspace and project for workspace members", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ workspace_id: "workspace-1", environment_id: "project-1" }], rowCount: 1 } as never);

    await expect(assertTaskMember("task-1", "member")).resolves.toEqual({
      workspaceId: "workspace-1",
      environmentId: "project-1"
    });
  });

  it("denies access when the user isn't a member of the task's workspace", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await expect(assertTaskMember("task-1", "outsider")).rejects.toThrow("Task access denied");
  });
});
