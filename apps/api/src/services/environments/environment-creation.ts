import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "./environment-storage.js";
import { ensureProjectMemoryFilesForWorkspace } from "../workspaces/workspace-memory.js";

interface CreateEnvironmentInput {
  workspaceId: string;
  name: string;
  createdByUserId: string;
}

interface CreatedEnvironmentRow {
  id: string;
}

export interface CreatedEnvironment {
  id: string;
  name: string;
  rootPath: string;
}

async function insertEnvironment(input: CreateEnvironmentInput): Promise<string> {
  const envInsert = await query<CreatedEnvironmentRow>(
    `INSERT INTO environments (workspace_id, name, runtime_kind, root_path, created_by)
     VALUES ($1, $2, 'docker', '', $3)
     RETURNING id`,
    [input.workspaceId, input.name, input.createdByUserId]
  );

  return envInsert.rows[0].id;
}

async function deleteEnvironment(environmentId: string): Promise<void> {
  await query(`DELETE FROM environments WHERE id = $1`, [environmentId]);
}

export async function createEnvironment(input: CreateEnvironmentInput): Promise<CreatedEnvironment> {
  const envId = await insertEnvironment(input);

  try {
    const rootPath = await ensureEnvironmentStorageRoot({
      id: envId,
      workspace_id: input.workspaceId,
      root_path: ""
    });
    await ensureProjectMemoryFilesForWorkspace({
      workspaceId: input.workspaceId,
      projectId: envId,
      projectName: input.name
    });

    return {
      id: envId,
      name: input.name,
      rootPath
    };
  } catch (error) {
    try {
      await deleteEnvironment(envId);
    } catch (cleanupError) {
      console.error(`[environments] Failed to roll back environment ${envId} after provisioning error`, cleanupError);
    }

    throw error;
  }
}
