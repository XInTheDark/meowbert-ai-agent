import type { StorageUsageSummary } from "@meowbert/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { getWorkspaceStorageUsage } from "./workspace-storage-usage.js";

export interface WorkspaceInviteActor {
  id: string;
  email: string;
  displayName: string | null;
}

export interface WorkspacePendingInvite {
  id: string;
  invitedUserId: string;
  email: string;
  displayName: string | null;
  invitedAt: string;
  invitedBy: WorkspaceInviteActor;
}

export interface WorkspaceInviteSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  invitedAt: string;
  owner: WorkspaceInviteActor;
  invitedBy: WorkspaceInviteActor;
}

export interface WorkspaceInviteDetail extends WorkspaceInviteSummary {
  workspaceCreatedAt: string;
  memberCount: number;
  environmentCount: number;
  storage: StorageUsageSummary | null;
}

export type InviteWorkspaceUserOutcome = "invited" | "already-invited" | "already-member";

export interface InviteWorkspaceUserResult {
  outcome: InviteWorkspaceUserOutcome;
  invite: WorkspacePendingInvite | null;
}

interface WorkspaceInvitePendingRow {
  id: string;
  invited_user_id: string;
  email: string;
  display_name: string | null;
  invited_at: string;
  invited_by_id: string;
  invited_by_email: string;
  invited_by_display_name: string | null;
}

interface WorkspaceInviteSummaryRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  invited_at: string;
  owner_id: string;
  owner_email: string;
  owner_display_name: string | null;
  invited_by_id: string;
  invited_by_email: string;
  invited_by_display_name: string | null;
}

interface WorkspaceInviteDetailRow extends WorkspaceInviteSummaryRow {
  workspace_created_at: string;
  workspace_root_path: string;
  member_count: number;
  environment_count: number;
}

interface WorkspaceMembershipRow {
  user_id: string;
}

interface WorkspaceInviteStatusRow {
  id: string;
  status: "pending" | "accepted" | "rejected";
}

interface WorkspaceInviteDecisionRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
}

function mapActor(input: {
  id: string;
  email: string;
  displayName: string | null;
}): WorkspaceInviteActor {
  return {
    id: input.id,
    email: input.email,
    displayName: input.displayName
  };
}

function mapPendingInvite(row: WorkspaceInvitePendingRow): WorkspacePendingInvite {
  return {
    id: row.id,
    invitedUserId: row.invited_user_id,
    email: row.email,
    displayName: row.display_name,
    invitedAt: row.invited_at,
    invitedBy: mapActor({
      id: row.invited_by_id,
      email: row.invited_by_email,
      displayName: row.invited_by_display_name
    })
  };
}

function mapInviteSummary(row: WorkspaceInviteSummaryRow): WorkspaceInviteSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    invitedAt: row.invited_at,
    owner: mapActor({
      id: row.owner_id,
      email: row.owner_email,
      displayName: row.owner_display_name
    }),
    invitedBy: mapActor({
      id: row.invited_by_id,
      email: row.invited_by_email,
      displayName: row.invited_by_display_name
    })
  };
}

async function selectPendingWorkspaceInvite(
  client: PoolClient,
  workspaceId: string,
  inviteId: string
): Promise<WorkspacePendingInvite | null> {
  const inviteRes = await client.query<WorkspaceInvitePendingRow>(
    `SELECT wi.id,
            wi.invited_user_id,
            u.email,
            u.display_name,
            wi.created_at::text AS invited_at,
            inviter.id AS invited_by_id,
            inviter.email AS invited_by_email,
            inviter.display_name AS invited_by_display_name
       FROM workspace_invites wi
       JOIN users u ON u.id = wi.invited_user_id
      JOIN users inviter ON inviter.id = wi.invited_by_user_id
      WHERE wi.workspace_id = $1
        AND wi.id = $2
        AND wi.status = 'pending'`,
    [workspaceId, inviteId]
  );

  if ((inviteRes.rowCount ?? 0) === 0) {
    return null;
  }

  return mapPendingInvite(inviteRes.rows[0]);
}

async function selectPendingWorkspaceInviteForDecision(
  client: PoolClient,
  inviteId: string,
  invitedUserId: string
): Promise<WorkspaceInviteDecisionRow | null> {
  const inviteRes = await client.query<WorkspaceInviteDecisionRow>(
    `SELECT wi.id,
            wi.workspace_id,
            w.name AS workspace_name
       FROM workspace_invites wi
      JOIN workspaces w ON w.id = wi.workspace_id
      WHERE wi.id = $1
        AND wi.invited_user_id = $2
        AND wi.status = 'pending'
      FOR UPDATE OF wi`,
    [inviteId, invitedUserId]
  );

  if ((inviteRes.rowCount ?? 0) === 0) {
    return null;
  }

  return inviteRes.rows[0];
}

export class WorkspaceInviteNotFoundError extends Error {
  constructor() {
    super("Workspace invite not found");
  }
}

export class WorkspaceInviteUserNotFoundError extends Error {
  constructor(email: string) {
    super(`User not found for email: ${email}`);
  }
}

export async function listWorkspaceInvites(workspaceId: string): Promise<WorkspacePendingInvite[]> {
  const result = await query<WorkspaceInvitePendingRow>(
    `SELECT wi.id,
            wi.invited_user_id,
            u.email,
            u.display_name,
            wi.created_at::text AS invited_at,
            inviter.id AS invited_by_id,
            inviter.email AS invited_by_email,
            inviter.display_name AS invited_by_display_name
       FROM workspace_invites wi
       JOIN users u ON u.id = wi.invited_user_id
       JOIN users inviter ON inviter.id = wi.invited_by_user_id
      WHERE wi.workspace_id = $1
        AND wi.status = 'pending'
      ORDER BY wi.created_at DESC,
               lower(u.email) ASC`,
    [workspaceId]
  );

  return result.rows.map(mapPendingInvite);
}

export async function inviteWorkspaceUserByEmail(input: {
  workspaceId: string;
  invitedByUserId: string;
  email: string;
}): Promise<InviteWorkspaceUserResult> {
  return withTransaction(async (client) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const userRes = await client.query<{
      id: string;
    }>(
      `SELECT id
         FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [normalizedEmail]
    );

    if ((userRes.rowCount ?? 0) === 0) {
      throw new WorkspaceInviteUserNotFoundError(normalizedEmail);
    }

    const invitedUserId = userRes.rows[0].id;
    const memberRes = await client.query<WorkspaceMembershipRow>(
      `SELECT user_id
         FROM workspace_members
        WHERE workspace_id = $1
          AND user_id = $2
        LIMIT 1`,
      [input.workspaceId, invitedUserId]
    );
    if ((memberRes.rowCount ?? 0) > 0) {
      return {
        outcome: "already-member",
        invite: null
      } satisfies InviteWorkspaceUserResult;
    }

    const existingInviteRes = await client.query<WorkspaceInviteStatusRow>(
      `SELECT id, status
         FROM workspace_invites
        WHERE workspace_id = $1
          AND invited_user_id = $2
        LIMIT 1
        FOR UPDATE`,
      [input.workspaceId, invitedUserId]
    );

    if ((existingInviteRes.rowCount ?? 0) > 0 && existingInviteRes.rows[0].status === "pending") {
      return {
        outcome: "already-invited",
        invite: await selectPendingWorkspaceInvite(client, input.workspaceId, existingInviteRes.rows[0].id)
      } satisfies InviteWorkspaceUserResult;
    }

    const upsertRes = await client.query<{ id: string }>(
      `INSERT INTO workspace_invites (workspace_id, invited_user_id, invited_by_user_id, status, created_at, updated_at, responded_at)
       VALUES ($1, $2, $3, 'pending', now(), now(), NULL)
       ON CONFLICT (workspace_id, invited_user_id)
       DO UPDATE SET invited_by_user_id = EXCLUDED.invited_by_user_id,
                     status = 'pending',
                     created_at = now(),
                     updated_at = now(),
                     responded_at = NULL
       RETURNING id`,
      [input.workspaceId, invitedUserId, input.invitedByUserId]
    );

    return {
      outcome: "invited",
      invite: await selectPendingWorkspaceInvite(client, input.workspaceId, upsertRes.rows[0].id)
    } satisfies InviteWorkspaceUserResult;
  });
}

export async function revokeWorkspaceInvite(input: {
  workspaceId: string;
  inviteId: string;
}): Promise<WorkspacePendingInvite> {
  return withTransaction(async (client) => {
    const invite = await selectPendingWorkspaceInvite(client, input.workspaceId, input.inviteId);
    if (!invite) {
      throw new WorkspaceInviteNotFoundError();
    }

    await client.query(
      `DELETE FROM workspace_invites
        WHERE workspace_id = $1
          AND id = $2
          AND status = 'pending'`,
      [input.workspaceId, input.inviteId]
    );

    return invite;
  });
}

export async function listPendingWorkspaceInvitesForUser(userId: string): Promise<WorkspaceInviteSummary[]> {
  const result = await query<WorkspaceInviteSummaryRow>(
    `SELECT wi.id,
            wi.workspace_id,
            w.name AS workspace_name,
            wi.created_at::text AS invited_at,
            owner.id AS owner_id,
            owner.email AS owner_email,
            owner.display_name AS owner_display_name,
            inviter.id AS invited_by_id,
            inviter.email AS invited_by_email,
            inviter.display_name AS invited_by_display_name
       FROM workspace_invites wi
       JOIN workspaces w ON w.id = wi.workspace_id
       JOIN workspace_members owner_membership
         ON owner_membership.workspace_id = wi.workspace_id
        AND owner_membership.role = 'owner'
       JOIN users owner ON owner.id = owner_membership.user_id
       JOIN users inviter ON inviter.id = wi.invited_by_user_id
       LEFT JOIN workspace_members existing_member
         ON existing_member.workspace_id = wi.workspace_id
        AND existing_member.user_id = wi.invited_user_id
      WHERE wi.invited_user_id = $1
        AND wi.status = 'pending'
        AND existing_member.user_id IS NULL
      ORDER BY wi.created_at DESC,
               w.name ASC`,
    [userId]
  );

  return result.rows.map(mapInviteSummary);
}

export async function getPendingWorkspaceInviteDetail(input: {
  inviteId: string;
  userId: string;
}): Promise<WorkspaceInviteDetail> {
  const result = await query<WorkspaceInviteDetailRow>(
    `SELECT wi.id,
            wi.workspace_id,
            w.name AS workspace_name,
            wi.created_at::text AS invited_at,
            w.created_at::text AS workspace_created_at,
            w.root_path AS workspace_root_path,
            owner.id AS owner_id,
            owner.email AS owner_email,
            owner.display_name AS owner_display_name,
            inviter.id AS invited_by_id,
            inviter.email AS invited_by_email,
            inviter.display_name AS invited_by_display_name,
            (SELECT COUNT(*)::int FROM workspace_members wm WHERE wm.workspace_id = wi.workspace_id) AS member_count,
            (SELECT COUNT(*)::int FROM environments e WHERE e.workspace_id = wi.workspace_id) AS environment_count
       FROM workspace_invites wi
       JOIN workspaces w ON w.id = wi.workspace_id
       JOIN workspace_members owner_membership
         ON owner_membership.workspace_id = wi.workspace_id
        AND owner_membership.role = 'owner'
       JOIN users owner ON owner.id = owner_membership.user_id
       JOIN users inviter ON inviter.id = wi.invited_by_user_id
       LEFT JOIN workspace_members existing_member
         ON existing_member.workspace_id = wi.workspace_id
        AND existing_member.user_id = wi.invited_user_id
      WHERE wi.id = $1
        AND wi.invited_user_id = $2
        AND wi.status = 'pending'
        AND existing_member.user_id IS NULL
      LIMIT 1`,
    [input.inviteId, input.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new WorkspaceInviteNotFoundError();
  }

  const row = result.rows[0];
  let storage: StorageUsageSummary | null = null;
  try {
    storage = await getWorkspaceStorageUsage({
      workspaceId: row.workspace_id,
      workspaceRootPath: row.workspace_root_path,
      actorUserId: input.userId
    });
  } catch {
    storage = null;
  }

  return {
    ...mapInviteSummary(row),
    workspaceCreatedAt: row.workspace_created_at,
    memberCount: row.member_count,
    environmentCount: row.environment_count,
    storage
  };
}

export async function acceptWorkspaceInvite(input: {
  inviteId: string;
  userId: string;
}): Promise<{ workspaceId: string; workspaceName: string; createdMembership: boolean }> {
  return withTransaction(async (client) => {
    const invite = await selectPendingWorkspaceInviteForDecision(client, input.inviteId, input.userId);
    if (!invite) {
      throw new WorkspaceInviteNotFoundError();
    }

    const membershipInsertRes = await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [invite.workspace_id, input.userId]
    );

    await client.query(
      `UPDATE workspace_invites
          SET status = 'accepted',
              responded_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [invite.id]
    );

    return {
      workspaceId: invite.workspace_id,
      workspaceName: invite.workspace_name,
      createdMembership: (membershipInsertRes.rowCount ?? 0) > 0
    };
  });
}

export async function rejectWorkspaceInvite(input: {
  inviteId: string;
  userId: string;
}): Promise<{ workspaceId: string; workspaceName: string }> {
  return withTransaction(async (client) => {
    const invite = await selectPendingWorkspaceInviteForDecision(client, input.inviteId, input.userId);
    if (!invite) {
      throw new WorkspaceInviteNotFoundError();
    }

    await client.query(
      `UPDATE workspace_invites
          SET status = 'rejected',
              responded_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [invite.id]
    );

    return {
      workspaceId: invite.workspace_id,
      workspaceName: invite.workspace_name
    };
  });
}
