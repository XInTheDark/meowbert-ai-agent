import { DEFAULT_MEMORY_ENABLED } from "@meowbert/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { getDefaultWorkspaceStorageBackendId } from "../storage/default-backend.js";
import { createDefaultProjectForWorkspace } from "./default-project.js";

function toSlugBase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "workspace";
}

async function deleteWorkspace(workspaceId: string): Promise<void> {
  await query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
}

export async function ensureUserHasWorkspace(userId: string): Promise<void> {
  const currentMembership = await query<{ workspace_id: string }>(
    `SELECT workspace_id
       FROM workspace_members
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );

  if ((currentMembership.rowCount ?? 0) > 0) {
    return;
  }

  const userResult = await query<{ display_name: string | null }>(
    `SELECT display_name
       FROM users
      WHERE id = $1`,
    [userId]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    throw new Error("User not found");
  }

  const displayName = userResult.rows[0]?.display_name ?? "My";
  const workspaceName = `${displayName} Workspace`;
  const slugBase = toSlugBase(workspaceName);
  let createdWorkspaceId: string | null = null;

  await withTransaction(async (client: PoolClient) => {
    const existing = await client.query<{ workspace_id: string }>(
      `SELECT workspace_id
         FROM workspace_members
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    );

    if ((existing.rowCount ?? 0) > 0) {
      return;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = Math.floor(Math.random() * 100000);
      const slug = `${slugBase}-${suffix}`;

      try {
        const defaultStorageBackendId = await getDefaultWorkspaceStorageBackendId(client);

        const ws = await client.query<{ id: string }>(
          `INSERT INTO workspaces (name, slug, storage_backend_id)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [workspaceName, slug, defaultStorageBackendId]
        );

        const workspaceId = ws.rows[0].id;

        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, userId]
        );

        await client.query(
          `INSERT INTO workspace_settings (workspace_id, memory_enabled)
           VALUES ($1, $2)
           ON CONFLICT (workspace_id) DO NOTHING`,
          [workspaceId, DEFAULT_MEMORY_ENABLED]
        );

        createdWorkspaceId = workspaceId;
        return;
      } catch (error) {
        // Retry on slug collision, bubble up all other database errors.
        if (!(error instanceof Error) || !("code" in error) || (error as { code?: string }).code !== "23505") {
          throw error;
        }
      }
    }

    throw new Error("Unable to allocate workspace slug");
  });

  if (!createdWorkspaceId) {
    return;
  }

  try {
    await createDefaultProjectForWorkspace({
      workspaceId: createdWorkspaceId,
      userId,
      displayName,
      workspaceName
    });
  } catch (error) {
    try {
      await deleteWorkspace(createdWorkspaceId);
    } catch (cleanupError) {
      console.error(`[workspaces] Failed to roll back workspace ${createdWorkspaceId} after default project provisioning error`, cleanupError);
    }

    throw error;
  }
}
