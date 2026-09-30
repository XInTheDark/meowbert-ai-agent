import { query } from "../../lib/db.js";

export async function assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const result = await query(
    `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
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
       JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE e.id = $1
        AND wm.user_id = $2
        AND e.status != 'archived'`,
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
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = $2
      WHERE t.id = $1`,
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
