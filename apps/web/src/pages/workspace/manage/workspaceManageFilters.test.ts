import { describe, expect, it } from "vitest";
import type { WorkspaceInviteSummary } from "../../../lib/types";
import type { WorkspaceListItem } from "./workspaceManageTypes";
import { filterInviteRows, filterWorkspaceRows, sortWorkspaceRows } from "./workspaceManageFilters";

const workspaces: WorkspaceListItem[] = [
  {
    id: "ws_old",
    name: "Older",
    role: "member",
    joinedAt: "2026-04-01T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    owner: { id: "u_1", email: "owner@example.com", displayName: "Owner" },
    memberCount: 2,
    projectCount: 1,
    pendingInviteCount: 0
  },
  {
    id: "ws_current",
    name: "Current",
    role: "owner",
    joinedAt: "2026-04-01T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    owner: { id: "u_2", email: "me@example.com", displayName: "Me" },
    memberCount: 1,
    projectCount: 3,
    pendingInviteCount: 0
  }
];

const invites: WorkspaceInviteSummary[] = [
  {
    id: "invite_1",
    workspaceId: "ws_invite",
    workspaceName: "Client Space",
    invitedAt: "2026-04-03T00:00:00.000Z",
    owner: { id: "u_3", email: "client@example.com", displayName: "Client" },
    invitedBy: { id: "u_4", email: "lead@example.com", displayName: "Lead" }
  }
];

describe("workspace manage filters", () => {
  it("pins the current workspace before updated ordering", () => {
    expect(sortWorkspaceRows(workspaces, "ws_current").map((workspace) => workspace.id)).toEqual([
      "ws_current",
      "ws_old"
    ]);
  });

  it("filters workspace rows by owner and role", () => {
    expect(filterWorkspaceRows(workspaces, "owner").map((workspace) => workspace.id)).toEqual(["ws_old", "ws_current"]);
    expect(filterWorkspaceRows(workspaces, "Current").map((workspace) => workspace.id)).toEqual(["ws_current"]);
  });

  it("filters invite rows by workspace and inviter", () => {
    expect(filterInviteRows(invites, "client").map((invite) => invite.id)).toEqual(["invite_1"]);
    expect(filterInviteRows(invites, "lead").map((invite) => invite.id)).toEqual(["invite_1"]);
  });
});
