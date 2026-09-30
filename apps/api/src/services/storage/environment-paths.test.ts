import { describe, expect, it, beforeEach, vi } from "vitest";
import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { ensureEnvironmentRootById, resolveTaskInputsDirForEnvironment } from "./environment-paths.js";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../environments/environment-storage.js", () => ({
  ensureEnvironmentStorageRoot: vi.fn()
}));

describe("environment-paths", () => {
  const mockedQuery = vi.mocked(query);
  const mockedEnsureEnvironmentStorageRoot = vi.mocked(ensureEnvironmentStorageRoot);

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedEnsureEnvironmentStorageRoot.mockReset();
  });

  it("resolves environment roots by environment id", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          id: "env-1",
          workspace_id: "ws-1",
          root_path: "/runtime/env"
        }
      ]
    });
    mockedEnsureEnvironmentStorageRoot.mockResolvedValueOnce("/mnt/env");

    await expect(ensureEnvironmentRootById("env-1")).resolves.toBe("/mnt/env");
    expect(mockedEnsureEnvironmentStorageRoot).toHaveBeenCalledWith({
      id: "env-1",
      workspace_id: "ws-1",
      root_path: "/runtime/env"
    });
  });

  it("resolves nested task input directories from the persisted task root path", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          environment_id: "env-1",
          workspace_id: "ws-1",
          root_path: "/runtime/env",
          task_root_path: ".meowbert/task-runs/parent/subtasks/task-2"
        }
      ]
    });
    mockedEnsureEnvironmentStorageRoot.mockResolvedValueOnce("/mnt/env");

    await expect(resolveTaskInputsDirForEnvironment({
      environmentId: "env-1",
      taskId: "task-2"
    })).resolves.toBe("/mnt/env/.meowbert/task-runs/parent/subtasks/task-2/inputs");
  });
});
