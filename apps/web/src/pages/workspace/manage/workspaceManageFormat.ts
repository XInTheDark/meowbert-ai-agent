import type { WorkspaceInviteActor, WorkspaceInviteDetail, WorkspaceMember } from "../../../lib/types";
import { formatBytes } from "../../../lib/utils";

export function formatInviteStorage(invite: WorkspaceInviteDetail): string {
  if (!invite.storage) {
    return "Unavailable";
  }

  if (invite.storage.limitBytes === null) {
    return `Used ${formatBytes(invite.storage.usedBytes)} (no limit)`;
  }

  return `${formatBytes(invite.storage.usedBytes)} / ${formatBytes(invite.storage.limitBytes)}`;
}

export function formatActor(actor: WorkspaceInviteActor | null): string {
  if (!actor) {
    return "Unknown";
  }

  return actor.displayName || actor.email;
}

export function formatMemberState(member: WorkspaceMember): string {
  if (member.signupApprovalStatus === "pending") {
    return "Pending approval";
  }

  if (!member.isActive || member.signupApprovalStatus === "rejected") {
    return "Inactive";
  }

  return member.role === "owner" ? "Owner" : "Member";
}
