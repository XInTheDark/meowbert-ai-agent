import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

import { query } from "../../lib/db.js";
import { resolveConnectorPairedUserId } from "./connector-pairing.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("resolveConnectorPairedUserId", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the paired workspace user id when one exists", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([
      {
        user_id: "admin-user"
      }
    ]));

    await expect(resolveConnectorPairedUserId({
      bindingId: "binding-1",
      externalUserId: "external-1"
    })).resolves.toBe("admin-user");
  });

  it("returns null when the external connector user is not paired", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([]));

    await expect(resolveConnectorPairedUserId({
      bindingId: "binding-1",
      externalUserId: "external-1"
    })).resolves.toBeNull();
  });

  it("throws when the same external connector user maps to multiple workspace users", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([
      {
        user_id: "user-1"
      },
      {
        user_id: "user-2"
      }
    ]));

    await expect(resolveConnectorPairedUserId({
      bindingId: "binding-1",
      externalUserId: "external-1"
    })).rejects.toThrow("Connector external user is paired with multiple workspace users");
  });
});
