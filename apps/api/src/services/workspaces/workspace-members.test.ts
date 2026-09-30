import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import {
  WorkspaceMemberOwnerLeaveError,
  WorkspaceMemberNotFoundError,
  WorkspaceMemberOwnerRemovalError,
  WorkspaceMemberSelfRemovalError,
  leaveWorkspace,
  listWorkspaceMembers,
  removeWorkspaceMember
} from "./workspace-members.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("workspace-members service", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const client = {
    query: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  it("lists workspace members with normalized response fields", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{
      id: "user-1",
      email: "owner@example.com",
      display_name: "Owner",
      role: "owner" as const,
      joined_at: "2026-03-12T00:00:00.000Z",
      is_active: true,
      signup_approval_status: "approved" as const
    }]));

    await expect(listWorkspaceMembers("workspace-1")).resolves.toEqual([{
      id: "user-1",
      email: "owner@example.com",
      displayName: "Owner",
      role: "owner",
      joinedAt: "2026-03-12T00:00:00.000Z",
      isActive: true,
      signupApprovalStatus: "approved"
    }]);
  });

  it("removes a non-owner member", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{
        id: "user-2",
        email: "member@example.com",
        display_name: "Member",
        role: "member" as const,
        joined_at: "2026-03-12T01:00:00.000Z",
        is_active: true,
        signup_approval_status: "approved" as const
      }]))
      .mockResolvedValueOnce(buildRowsResult([{}]));

    await expect(removeWorkspaceMember({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "user-2"
    })).resolves.toEqual({
      id: "user-2",
      email: "member@example.com",
      displayName: "Member",
      role: "member",
      joinedAt: "2026-03-12T01:00:00.000Z",
      isActive: true,
      signupApprovalStatus: "approved"
    });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("DELETE FROM workspace_members"),
      ["workspace-1", "user-2"]
    );
  });

  it("blocks owners from removing themselves", async () => {
    client.query.mockResolvedValueOnce(buildRowsResult([{
      id: "owner-1",
      email: "owner@example.com",
      display_name: "Owner",
      role: "owner" as const,
      joined_at: "2026-03-12T01:00:00.000Z",
      is_active: true,
      signup_approval_status: "approved" as const
    }]));

    await expect(removeWorkspaceMember({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "owner-1"
    })).rejects.toBeInstanceOf(WorkspaceMemberSelfRemovalError);
  });

  it("blocks removing owners in v1", async () => {
    client.query.mockResolvedValueOnce(buildRowsResult([{
      id: "owner-2",
      email: "co-owner@example.com",
      display_name: "Co-owner",
      role: "owner" as const,
      joined_at: "2026-03-12T01:00:00.000Z",
      is_active: true,
      signup_approval_status: "approved" as const
    }]));

    await expect(removeWorkspaceMember({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "owner-2"
    })).rejects.toBeInstanceOf(WorkspaceMemberOwnerRemovalError);
  });

  it("throws when removing a missing workspace member", async () => {
    client.query.mockResolvedValueOnce(buildRowsResult([]));

    await expect(removeWorkspaceMember({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      targetUserId: "missing-user"
    })).rejects.toBeInstanceOf(WorkspaceMemberNotFoundError);
  });

  it("allows members to leave a workspace", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{
        id: "user-2",
        email: "member@example.com",
        display_name: "Member",
        role: "member" as const,
        joined_at: "2026-03-12T01:00:00.000Z",
        is_active: true,
        signup_approval_status: "approved" as const
      }]))
      .mockResolvedValueOnce(buildRowsResult([{}]));

    await expect(leaveWorkspace({
      workspaceId: "workspace-1",
      userId: "user-2"
    })).resolves.toEqual({
      id: "user-2",
      email: "member@example.com",
      displayName: "Member",
      role: "member",
      joinedAt: "2026-03-12T01:00:00.000Z",
      isActive: true,
      signupApprovalStatus: "approved"
    });
  });

  it("blocks owners from leaving their own workspace", async () => {
    client.query.mockResolvedValueOnce(buildRowsResult([{
      id: "owner-1",
      email: "owner@example.com",
      display_name: "Owner",
      role: "owner" as const,
      joined_at: "2026-03-12T01:00:00.000Z",
      is_active: true,
      signup_approval_status: "approved" as const
    }]));

    await expect(leaveWorkspace({
      workspaceId: "workspace-1",
      userId: "owner-1"
    })).rejects.toBeInstanceOf(WorkspaceMemberOwnerLeaveError);
  });
});
