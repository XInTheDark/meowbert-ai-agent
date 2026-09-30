import type { WorkspaceInviteSummary } from "../../../lib/types";
import type { WorkspaceListItem } from "./workspaceManageTypes";
import { formatActor } from "./workspaceManageFormat";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function filterWorkspaceRows(workspaces: WorkspaceListItem[], query: string): WorkspaceListItem[] {
  const normalized = normalize(query);
  if (!normalized) {
    return workspaces;
  }

  return workspaces.filter((workspace) => [
    workspace.name,
    workspace.role,
    formatActor(workspace.owner)
  ].join(" ").toLowerCase().includes(normalized));
}

export function filterInviteRows(invites: WorkspaceInviteSummary[], query: string): WorkspaceInviteSummary[] {
  const normalized = normalize(query);
  if (!normalized) {
    return invites;
  }

  return invites.filter((invite) => [
    invite.workspaceName,
    formatActor(invite.owner),
    formatActor(invite.invitedBy)
  ].join(" ").toLowerCase().includes(normalized));
}

export function sortWorkspaceRows(workspaces: WorkspaceListItem[], activeWorkspaceId: string): WorkspaceListItem[] {
  return [...workspaces].sort((left, right) => {
    if (left.id === activeWorkspaceId) {
      return -1;
    }
    if (right.id === activeWorkspaceId) {
      return 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}
