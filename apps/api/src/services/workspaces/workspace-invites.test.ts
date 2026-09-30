import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("./workspace-storage-usage.js", () => ({
  getWorkspaceStorageUsage: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { getWorkspaceStorageUsage } from "./workspace-storage-usage.js";
import {
  WorkspaceInviteNotFoundError,
  WorkspaceInviteUserNotFoundError,
  acceptWorkspaceInvite,
  getPendingWorkspaceInviteDetail,
  inviteWorkspaceUserByEmail,
  listPendingWorkspaceInvitesForUser,
  listWorkspaceInvites,
  rejectWorkspaceInvite,
  revokeWorkspaceInvite
} from "./workspace-invites.js";

function buildRowsResult<Row extends object>(rows: Row[], rowCount = rows.length): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount
  };
}

describe("workspace-invites service", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedGetWorkspaceStorageUsage = vi.mocked(getWorkspaceStorageUsage);
  const client = {
    query: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
  });

  it("lists pending invites for workspace owners", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{
      id: "invite-1",
      invited_user_id: "user-2",
      email: "member@example.com",
      display_name: "Member",
      invited_at: "2026-03-12T01:00:00.000Z",
      invited_by_id: "owner-1",
      invited_by_email: "owner@example.com",
      invited_by_display_name: "Owner"
    }]));

    await expect(listWorkspaceInvites("workspace-1")).resolves.toEqual([{
      id: "invite-1",
      invitedUserId: "user-2",
      email: "member@example.com",
      displayName: "Member",
      invitedAt: "2026-03-12T01:00:00.000Z",
      invitedBy: {
        id: "owner-1",
        email: "owner@example.com",
        displayName: "Owner"
      }
    }]);
  });

  it("creates a pending invite when the user is not already a member", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{ id: "user-2" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "invite-1" }]))
      .mockResolvedValueOnce(buildRowsResult([{
        id: "invite-1",
        invited_user_id: "user-2",
        email: "member@example.com",
        display_name: "Member",
        invited_at: "2026-03-12T02:00:00.000Z",
        invited_by_id: "owner-1",
        invited_by_email: "owner@example.com",
        invited_by_display_name: "Owner"
      }]));

    await expect(inviteWorkspaceUserByEmail({
      workspaceId: "workspace-1",
      invitedByUserId: "owner-1",
      email: "Member@Example.com"
    })).resolves.toEqual({
      outcome: "invited",
      invite: {
        id: "invite-1",
        invitedUserId: "user-2",
        email: "member@example.com",
        displayName: "Member",
        invitedAt: "2026-03-12T02:00:00.000Z",
        invitedBy: {
          id: "owner-1",
          email: "owner@example.com",
          displayName: "Owner"
        }
      }
    });

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT id"),
      ["member@example.com"]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("INSERT INTO workspace_invites"),
      ["workspace-1", "user-2", "owner-1"]
    );
  });

  it("returns already-member when the invited user already has access", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{ id: "user-2" }]))
      .mockResolvedValueOnce(buildRowsResult([{ user_id: "user-2" }]));

    await expect(inviteWorkspaceUserByEmail({
      workspaceId: "workspace-1",
      invitedByUserId: "owner-1",
      email: "member@example.com"
    })).resolves.toEqual({
      outcome: "already-member",
      invite: null
    });
  });

  it("returns the existing pending invite when one already exists", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{ id: "user-2" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "invite-1", status: "pending" as const }]))
      .mockResolvedValueOnce(buildRowsResult([{
        id: "invite-1",
        invited_user_id: "user-2",
        email: "member@example.com",
        display_name: null,
        invited_at: "2026-03-12T02:00:00.000Z",
        invited_by_id: "owner-1",
        invited_by_email: "owner@example.com",
        invited_by_display_name: "Owner"
      }]));

    await expect(inviteWorkspaceUserByEmail({
      workspaceId: "workspace-1",
      invitedByUserId: "owner-1",
      email: "member@example.com"
    })).resolves.toEqual({
      outcome: "already-invited",
      invite: {
        id: "invite-1",
        invitedUserId: "user-2",
        email: "member@example.com",
        displayName: null,
        invitedAt: "2026-03-12T02:00:00.000Z",
        invitedBy: {
          id: "owner-1",
          email: "owner@example.com",
          displayName: "Owner"
        }
      }
    });
  });

  it("throws when inviting an email that does not belong to a user", async () => {
    client.query.mockResolvedValueOnce(buildRowsResult([]));

    await expect(inviteWorkspaceUserByEmail({
      workspaceId: "workspace-1",
      invitedByUserId: "owner-1",
      email: "missing@example.com"
    })).rejects.toBeInstanceOf(WorkspaceInviteUserNotFoundError);
  });

  it("loads pending invite details for recipients", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{
      id: "invite-1",
      workspace_id: "workspace-1",
      workspace_name: "Alpha",
      invited_at: "2026-03-12T03:00:00.000Z",
      workspace_created_at: "2026-03-01T00:00:00.000Z",
      workspace_root_path: "/tmp/workspace-1",
      owner_id: "owner-1",
      owner_email: "owner@example.com",
      owner_display_name: "Owner",
      invited_by_id: "owner-1",
      invited_by_email: "owner@example.com",
      invited_by_display_name: "Owner",
      member_count: 3,
      environment_count: 2
    }]));
    mockedGetWorkspaceStorageUsage.mockResolvedValueOnce({
      usedBytes: 1024,
      limitBytes: 2048,
      availableBytes: 1024,
      usagePercent: 50,
      isOverLimit: false
    });

    await expect(getPendingWorkspaceInviteDetail({
      inviteId: "invite-1",
      userId: "user-2"
    })).resolves.toEqual({
      id: "invite-1",
      workspaceId: "workspace-1",
      workspaceName: "Alpha",
      invitedAt: "2026-03-12T03:00:00.000Z",
      workspaceCreatedAt: "2026-03-01T00:00:00.000Z",
      memberCount: 3,
      environmentCount: 2,
      owner: {
        id: "owner-1",
        email: "owner@example.com",
        displayName: "Owner"
      },
      invitedBy: {
        id: "owner-1",
        email: "owner@example.com",
        displayName: "Owner"
      },
      storage: {
        usedBytes: 1024,
        limitBytes: 2048,
        availableBytes: 1024,
        usagePercent: 50,
        isOverLimit: false
      }
    });
  });

  it("accepts an invite and adds the user to the workspace", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{
        id: "invite-1",
        workspace_id: "workspace-1",
        workspace_name: "Alpha"
      }]))
      .mockResolvedValueOnce(buildRowsResult([], 1))
      .mockResolvedValueOnce(buildRowsResult([], 1));

    await expect(acceptWorkspaceInvite({
      inviteId: "invite-1",
      userId: "user-2"
    })).resolves.toEqual({
      workspaceId: "workspace-1",
      workspaceName: "Alpha",
      createdMembership: true
    });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("VALUES ($1, $2, 'member')"),
      ["workspace-1", "user-2"]
    );
  });

  it("rejects an invite without creating a membership", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{
        id: "invite-1",
        workspace_id: "workspace-1",
        workspace_name: "Alpha"
      }]))
      .mockResolvedValueOnce(buildRowsResult([], 1));

    await expect(rejectWorkspaceInvite({
      inviteId: "invite-1",
      userId: "user-2"
    })).resolves.toEqual({
      workspaceId: "workspace-1",
      workspaceName: "Alpha"
    });
  });

  it("revokes a pending invite for owners", async () => {
    client.query
      .mockResolvedValueOnce(buildRowsResult([{
        id: "invite-1",
        invited_user_id: "user-2",
        email: "member@example.com",
        display_name: "Member",
        invited_at: "2026-03-12T02:00:00.000Z",
        invited_by_id: "owner-1",
        invited_by_email: "owner@example.com",
        invited_by_display_name: "Owner"
      }]))
      .mockResolvedValueOnce(buildRowsResult([], 1));

    await expect(revokeWorkspaceInvite({
      workspaceId: "workspace-1",
      inviteId: "invite-1"
    })).resolves.toEqual({
      id: "invite-1",
      invitedUserId: "user-2",
      email: "member@example.com",
      displayName: "Member",
      invitedAt: "2026-03-12T02:00:00.000Z",
      invitedBy: {
        id: "owner-1",
        email: "owner@example.com",
        displayName: "Owner"
      }
    });
  });

  it("throws when accepting a missing invite", async () => {
    client.query.mockResolvedValueOnce(buildRowsResult([]));

    await expect(acceptWorkspaceInvite({
      inviteId: "invite-missing",
      userId: "user-2"
    })).rejects.toBeInstanceOf(WorkspaceInviteNotFoundError);
  });

  it("lists pending invites for recipients", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{
      id: "invite-1",
      workspace_id: "workspace-1",
      workspace_name: "Alpha",
      invited_at: "2026-03-12T03:00:00.000Z",
      owner_id: "owner-1",
      owner_email: "owner@example.com",
      owner_display_name: "Owner",
      invited_by_id: "owner-1",
      invited_by_email: "owner@example.com",
      invited_by_display_name: "Owner"
    }]));

    await expect(listPendingWorkspaceInvitesForUser("user-2")).resolves.toEqual([{
      id: "invite-1",
      workspaceId: "workspace-1",
      workspaceName: "Alpha",
      invitedAt: "2026-03-12T03:00:00.000Z",
      owner: {
        id: "owner-1",
        email: "owner@example.com",
        displayName: "Owner"
      },
      invitedBy: {
        id: "owner-1",
        email: "owner@example.com",
        displayName: "Owner"
      }
    }]);
  });
});
