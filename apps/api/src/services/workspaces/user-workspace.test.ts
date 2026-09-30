import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../storage/default-backend.js", () => ({
  getDefaultWorkspaceStorageBackendId: vi.fn()
}));

vi.mock("./default-project.js", () => ({
  createDefaultProjectForWorkspace: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { getDefaultWorkspaceStorageBackendId } from "../storage/default-backend.js";
import { createDefaultProjectForWorkspace } from "./default-project.js";
import { ensureUserHasWorkspace } from "./user-workspace.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("ensureUserHasWorkspace", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedGetDefaultWorkspaceStorageBackendId = vi.mocked(getDefaultWorkspaceStorageBackendId);
  const mockedCreateDefaultProjectForWorkspace = vi.mocked(createDefaultProjectForWorkspace);
  const client = {
    query: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  it("does nothing when the user already belongs to a workspace", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{ workspace_id: "ws-1" }]));

    await expect(ensureUserHasWorkspace("user-1")).resolves.toBeUndefined();

    expect(mockedWithTransaction).not.toHaveBeenCalled();
    expect(mockedCreateDefaultProjectForWorkspace).not.toHaveBeenCalled();
  });

  it("creates a workspace and default project when the user has none", async () => {
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ display_name: "Alice" }]));
    mockedGetDefaultWorkspaceStorageBackendId.mockResolvedValueOnce("local-default");
    mockedCreateDefaultProjectForWorkspace.mockResolvedValueOnce({
      id: "env-1",
      name: "Alice Project",
      rootPath: "/runtime/ws-1/env-1"
    });
    client.query
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "ws-1" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    await expect(ensureUserHasWorkspace("user-1")).resolves.toBeUndefined();

    expect(mockedCreateDefaultProjectForWorkspace).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      displayName: "Alice",
      workspaceName: "Alice Workspace"
    });
  });

  it("rolls back the new workspace if default project provisioning fails", async () => {
    const provisioningError = new Error("storage unavailable");
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ display_name: "Alice" }]))
      .mockResolvedValueOnce(buildRowsResult([]));
    mockedGetDefaultWorkspaceStorageBackendId.mockResolvedValueOnce("local-default");
    mockedCreateDefaultProjectForWorkspace.mockRejectedValueOnce(provisioningError);
    client.query
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "ws-2" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]));

    await expect(ensureUserHasWorkspace("user-2")).rejects.toThrow("storage unavailable");

    expect(mockedQuery).toHaveBeenNthCalledWith(
      3,
      "DELETE FROM workspaces WHERE id = $1",
      ["ws-2"]
    );
  });
});
