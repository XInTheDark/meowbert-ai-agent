import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("./environment-storage.js", () => ({
  ensureEnvironmentStorageRoot: vi.fn()
}));

vi.mock("../workspaces/workspace-memory.js", () => ({
  ensureProjectMemoryFilesForWorkspace: vi.fn()
}));

import { query } from "../../lib/db.js";
import { createEnvironment } from "./environment-creation.js";
import { ensureEnvironmentStorageRoot } from "./environment-storage.js";
import { ensureProjectMemoryFilesForWorkspace } from "../workspaces/workspace-memory.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("createEnvironment", () => {
  const mockedQuery = vi.mocked(query);
  const mockedEnsureEnvironmentStorageRoot = vi.mocked(ensureEnvironmentStorageRoot);
  const mockedEnsureProjectMemoryFilesForWorkspace = vi.mocked(ensureProjectMemoryFilesForWorkspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an environment and returns its provisioned root path", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{ id: "env-1" }]));
    mockedEnsureEnvironmentStorageRoot.mockResolvedValueOnce("/runtime/ws-1/environments/env-1/root");
    mockedEnsureProjectMemoryFilesForWorkspace.mockResolvedValueOnce(null);

    await expect(
      createEnvironment({
        workspaceId: "ws-1",
        name: "My Env",
        createdByUserId: "user-1"
      })
    ).resolves.toEqual({
      id: "env-1",
      name: "My Env",
      rootPath: "/runtime/ws-1/environments/env-1/root"
    });

    expect(mockedEnsureEnvironmentStorageRoot).toHaveBeenCalledWith({
      id: "env-1",
      workspace_id: "ws-1",
      root_path: ""
    });
    expect(mockedEnsureProjectMemoryFilesForWorkspace).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      projectId: "env-1",
      projectName: "My Env"
    });
  });

  it("removes the inserted environment if storage provisioning fails", async () => {
    const provisioningError = new Error("mount did not become ready");
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([{ id: "env-2" }]))
      .mockResolvedValueOnce(buildRowsResult([]));
    mockedEnsureEnvironmentStorageRoot.mockRejectedValueOnce(provisioningError);

    await expect(
      createEnvironment({
        workspaceId: "ws-2",
        name: "Broken Env",
        createdByUserId: "user-2"
      })
    ).rejects.toThrow("mount did not become ready");

    expect(mockedQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO environments"),
      ["ws-2", "Broken Env", "user-2"]
    );
    expect(mockedQuery).toHaveBeenNthCalledWith(
      2,
      "DELETE FROM environments WHERE id = $1",
      ["env-2"]
    );
  });
});
