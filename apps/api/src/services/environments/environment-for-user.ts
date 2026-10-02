import { DEFAULT_MEMORY_ENABLED, resolveEffectiveEnvironmentJsonPayload } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { ensureWorkspaceStorageRoot } from "../workspaces/workspace-storage.js";
import { ensureEnvironmentStorageRoot } from "./environment-storage.js";

export interface EnvironmentForUser {
  id: string;
  workspace_id: string;
  name: string;
  root_path: string;
  status: string;
  json_payload: Record<string, unknown>;
  workspace_model_defaults_json: Record<string, unknown>;
  effective_json_payload: Record<string, unknown>;
  workspace_root_path: string;
  workspace_memory_enabled: boolean;
  workspace_run_as_root: boolean;
}

export async function getEnvironmentForUser(envId: string, userId: string): Promise<EnvironmentForUser> {
  const envRes = await query<EnvironmentForUser>(
    `SELECT e.id,
            e.workspace_id,
            e.name,
            e.root_path,
            e.status,
            e.json_payload,
            COALESCE(ws.model_defaults_json, '{}'::jsonb) AS workspace_model_defaults_json,
            w.root_path AS workspace_root_path,
            COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS workspace_memory_enabled,
            COALESCE(ws.run_as_root, false) AS workspace_run_as_root
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
       LEFT JOIN workspace_settings ws ON ws.workspace_id = e.workspace_id
       JOIN workspace_members wm ON wm.workspace_id = e.workspace_id
      WHERE e.id = $1
        AND wm.user_id = $2`,
    [envId, userId]
  );

  if ((envRes.rowCount ?? 0) === 0) {
    throw new Error("Project not found");
  }

  const environment = envRes.rows[0];
  const environmentRoot = await ensureEnvironmentStorageRoot(environment);
  const workspaceRoot = await ensureWorkspaceStorageRoot({
    id: environment.workspace_id,
    root_path: environment.workspace_root_path
  });

  return {
    ...environment,
    effective_json_payload: resolveEffectiveEnvironmentJsonPayload({
      workspaceModelDefaults: environment.workspace_model_defaults_json,
      environmentPayload: environment.json_payload
    }),
    root_path: environmentRoot,
    workspace_root_path: workspaceRoot
  };
}
