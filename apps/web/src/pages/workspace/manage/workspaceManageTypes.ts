import type {
  Workspace,
  WorkspaceInviteActor,
  WorkspaceInviteDetail,
  WorkspaceInviteSummary,
  WorkspaceMember
} from "../../../lib/types";
import type { WorkspaceIconKey } from "@meowbert/shared/workspace-icons";

export interface WorkspaceListItem extends Workspace {
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  owner: WorkspaceInviteActor | null;
  memberCount: number;
  projectCount: number;
  environmentCount?: number;
  pendingInviteCount: number;
}

export interface WorkspaceListResponse {
  items: WorkspaceListItem[];
}

export interface WorkspaceInviteListResponse {
  items: WorkspaceInviteSummary[];
}

export interface WorkspaceMembersResponse {
  items: WorkspaceMember[];
}

export interface WorkspaceInviteAcceptResponse {
  workspaceId: string;
  workspaceName: string;
  createdMembership: boolean;
}

export type WorkspaceManageTab = "workspaces" | "invites";

export interface WorkspaceManageState {
  workspaces: WorkspaceListItem[];
  invites: WorkspaceInviteSummary[];
  inviteDetailsById: Record<string, WorkspaceInviteDetail>;
  inviteDetailErrorsById: Record<string, string>;
  inviteDetailLoadingById: Record<string, boolean>;
  workspaceMembersById: Record<string, WorkspaceMember[]>;
  workspaceMembersErrorById: Record<string, string>;
  workspaceMembersLoadingById: Record<string, boolean>;
  expandedWorkspaceIds: Record<string, boolean>;
  loading: boolean;
  isCreating: boolean;
  error: string | null;
  editingId: string | null;
  editName: string;
  editIconKey: WorkspaceIconKey;
  inviteDecisionId: string | null;
  leavingWorkspaceId: string | null;
}
