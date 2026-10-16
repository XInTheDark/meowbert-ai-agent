import { query } from "../../lib/db.js";

// Super admins pass member checks in every workspace so they can open any task or project by
// link. Owner-only actions still require a real owner membership.
// The user ID is always bound as $2.
function memberOrSuperAdmin(workspaceIdColumn: string): string {
  return `(
    EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = ${workspaceIdColumn} AND wm.user_id = $2)
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_super_admin = true)
  )`;
}

export async function assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const result = await query(
    `SELECT 1 FROM workspaces WHERE id = $1 AND ${memberOrSuperAdmin("workspaces.id")}`,
    [workspaceId, userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Workspace access denied");
  }
}

export async function assertWorkspaceOwner(workspaceId: string, userId: string): Promise<void> {
  const result = await query<{ role: string }>(
    `SELECT role
       FROM workspace_members
      WHERE workspace_id = $1
        AND user_id = $2`,
    [workspaceId, userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Workspace access denied");
  }

  if (result.rows[0].role !== "owner") {
    throw new Error("Workspace access denied: only workspace owners can manage this connector");
  }
}

export async function assertEnvironmentMember(environmentId: string, userId: string): Promise<{ workspaceId: string }> {
  const result = await query<{ workspace_id: string }>(
    `SELECT e.workspace_id
       FROM environments e
      WHERE e.id = $1
        AND e.status != 'archived'
        AND ${memberOrSuperAdmin("e.workspace_id")}`,
    [environmentId, userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Environment access denied");
  }

  return {
    workspaceId: result.rows[0].workspace_id
  };
}

export async function assertTaskMember(
  taskId: string,
  userId: string
): Promise<{ workspaceId: string; environmentId: string }> {
  const result = await query<{ workspace_id: string; environment_id: string }>(
    `SELECT t.workspace_id, t.environment_id
       FROM tasks t
      WHERE t.id = $1
        AND ${memberOrSuperAdmin("t.workspace_id")}`,
    [taskId, userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Task access denied");
  }

  return {
    workspaceId: row.workspace_id,
    environmentId: row.environment_id
  };
}
