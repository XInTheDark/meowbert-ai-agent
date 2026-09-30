import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";

export type WorkspaceMemberRole = "owner" | "member";
export type WorkspaceMemberSignupApprovalStatus = "approved" | "pending" | "rejected";

export interface WorkspaceMemberSummary {
  id: string;
  email: string;
  displayName: string | null;
  role: WorkspaceMemberRole;
  joinedAt: string;
  isActive: boolean;
  signupApprovalStatus: WorkspaceMemberSignupApprovalStatus;
}

interface WorkspaceMemberRow {
  id: string;
  email: string;
  display_name: string | null;
  role: WorkspaceMemberRole;
  joined_at: string;
  is_active: boolean;
  signup_approval_status: WorkspaceMemberSignupApprovalStatus;
}

export class WorkspaceMemberNotFoundError extends Error {
  constructor() {
    super("Workspace member not found");
  }
}

export class WorkspaceMemberOwnerRemovalError extends Error {
  constructor() {
    super("Removing workspace owners is not supported yet");
  }
}

export class WorkspaceMemberSelfRemovalError extends Error {
  constructor() {
    super("Workspace owners cannot remove themselves");
  }
}

export class WorkspaceMemberOwnerLeaveError extends Error {
  constructor() {
    super("Workspace owners cannot leave their own workspace");
  }
}

function mapWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMemberSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    joinedAt: row.joined_at,
    isActive: row.is_active,
    signupApprovalStatus: row.signup_approval_status
  };
}

async function selectWorkspaceMember(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  options?: { forUpdate?: boolean }
): Promise<WorkspaceMemberSummary | null> {
  const lockClause = options?.forUpdate ? "FOR UPDATE OF wm" : "";
  const memberRes = await client.query<WorkspaceMemberRow>(
    `SELECT u.id,
            u.email,
            u.display_name,
            wm.role,
            wm.created_at::text AS joined_at,
            u.is_active,
            u.signup_approval_status
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
        AND wm.user_id = $2
      ${lockClause}`,
    [workspaceId, userId]
  );

  if ((memberRes.rowCount ?? 0) === 0) {
    return null;
  }

  return mapWorkspaceMember(memberRes.rows[0]);
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberSummary[]> {
  const result = await query<WorkspaceMemberRow>(
    `SELECT u.id,
            u.email,
            u.display_name,
            wm.role,
            wm.created_at::text AS joined_at,
            u.is_active,
            u.signup_approval_status
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY CASE WHEN wm.role = 'owner' THEN 0 ELSE 1 END,
               lower(COALESCE(u.display_name, u.email)) ASC,
               u.id ASC`,
    [workspaceId]
  );

  return result.rows.map(mapWorkspaceMember);
}

export async function removeWorkspaceMember(input: {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<WorkspaceMemberSummary> {
  return withTransaction(async (client) => {
    const member = await selectWorkspaceMember(client, input.workspaceId, input.targetUserId, { forUpdate: true });
    if (!member) {
      throw new WorkspaceMemberNotFoundError();
    }

    if (input.actorUserId === input.targetUserId) {
      throw new WorkspaceMemberSelfRemovalError();
    }

    if (member.role === "owner") {
      throw new WorkspaceMemberOwnerRemovalError();
    }

    await client.query(
      `DELETE FROM workspace_members
        WHERE workspace_id = $1
          AND user_id = $2
          AND role = 'member'`,
      [input.workspaceId, input.targetUserId]
    );

    return member;
  });
}

export async function leaveWorkspace(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceMemberSummary> {
  return withTransaction(async (client) => {
    const member = await selectWorkspaceMember(client, input.workspaceId, input.userId, { forUpdate: true });
    if (!member) {
      throw new WorkspaceMemberNotFoundError();
    }

    if (member.role === "owner") {
      throw new WorkspaceMemberOwnerLeaveError();
    }

    await client.query(
      `DELETE FROM workspace_members
        WHERE workspace_id = $1
          AND user_id = $2
          AND role = 'member'`,
      [input.workspaceId, input.userId]
    );

    return member;
  });
}
