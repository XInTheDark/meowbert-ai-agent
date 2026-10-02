import {
  DEFAULT_MEMORY_ENABLED,
  DEFAULT_ENVIRONMENT_PERSONALITY_ID,
  loadPersonalityPromptCatalog,
  listPersonalityOptions,
  resolveEffectiveEnvironmentJsonPayload,
  resolveEnvironmentPersonalityId,
  TASK_CLEANUP_EXPIRATION_DAYS_MAX,
  TASK_CLEANUP_EXPIRATION_DAYS_MIN
} from "@meowbert/shared";
import { z } from "zod";
import { createTaskHistorySearchQuerySchema } from "@meowbert/shared/task-history-search";
import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../../services/environments/environment-storage.js";
import { ensureWorkspaceStorageRoot } from "../../services/workspaces/workspace-storage.js";

export const workspaceParams = z.object({
  wsId: z.string().uuid()
});

export const environmentParams = z.object({
  envId: z.string().uuid()
});

export const workspaceEnvironmentCollectionPaths = [
  "/api/workspaces/:wsId/projects",
  "/api/workspaces/:wsId/environments"
] as const;

export const environmentEntityPaths = [
  "/api/projects/:envId",
  "/api/environments/:envId"
] as const;

export const environmentTaskListQuery = createTaskHistorySearchQuerySchema();

export const environmentTaskCancelBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(500).optional()
});

export const environmentTaskCleanupBody = z.object({
  expirationDays: z
    .number()
    .int()
    .min(TASK_CLEANUP_EXPIRATION_DAYS_MIN)
    .max(TASK_CLEANUP_EXPIRATION_DAYS_MAX)
    .nullable()
    .optional(),
  limit: z.number().int().min(1).max(500).optional()
});

const personalityPromptCatalog = loadPersonalityPromptCatalog();
export const personalityOptions = listPersonalityOptions(personalityPromptCatalog);
export const personalityDefaultId = resolveEnvironmentPersonalityId({
  requestedId: null,
  catalog: personalityPromptCatalog,
  defaultId: DEFAULT_ENVIRONMENT_PERSONALITY_ID
});

export const jsonObjectSchema = z
  .unknown()
  .refine((value) => typeof value === "object" && value !== null && !Array.isArray(value), "Expected a JSON object")
  .transform((value) => value as Record<string, unknown>);

export const environmentCleanupQuery = z.object({
  targetPercent: z.coerce.number().min(1).max(100).default(50),
  modifiedAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  modifiedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minSizeBytes: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  maxSizeBytes: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
});

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
