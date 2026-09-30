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
import fsPromises from "node:fs/promises";
import path from "node:path";
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
export const FILE_PREVIEW_LIMIT_BYTES = 300_000;
export const FILE_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

export const jsonObjectSchema = z
  .unknown()
  .refine((value) => typeof value === "object" && value !== null && !Array.isArray(value), "Expected a JSON object")
  .transform((value) => value as Record<string, unknown>);

export const environmentFileQuery = z.object({
  path: z.string().max(1200).optional()
});

export const requiredEnvironmentFileQuery = z.object({
  path: z.string().min(1).max(1200)
});

export const environmentBatchFileDownloadQuery = z.object({
  path: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .transform((paths) => paths.map((value) => value.trim()).filter((value) => value.length > 0))
    .refine((paths) => paths.length > 0, { message: "At least one file path is required" })
    .refine((paths) => paths.length <= 200, { message: "A maximum of 200 paths can be downloaded at once" }),
  cwd: z.string().max(1200).optional().default("")
});

const booleanQuerySchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

export const environmentFileUploadQuery = z.object({
  path: z.string().max(1200).optional(),
  createDirectories: booleanQuerySchema.optional().default(false)
});

export const environmentCreateTextFileBody = z.object({
  name: z.string().trim().min(1).max(255),
  content: z.string().max(FILE_UPLOAD_LIMIT_BYTES)
}).strict();

export const environmentDeleteFilesBody = z.object({
  paths: z.array(z.string().min(1).max(1200)).min(1).max(200)
});

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

export function toWebPath(input: string): string {
  return input.split(path.sep).join("/");
}

export function assertPathInsideRoot(rootPath: string, absolutePath: string): void {
  const normalizedRoot = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
  if (absolutePath !== rootPath && !absolutePath.startsWith(normalizedRoot)) {
    throw new Error("Path is outside environment root");
  }
}

export function toIsoTimestamp(value: Date | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return value.toISOString();
}

export function sanitizeUploadFilename(filename: string | undefined): string {
  const base = path.basename((filename ?? "").trim());
  if (!base || base === "." || base === "..") {
    return `upload-${Date.now()}.bin`;
  }
  return base;
}

export async function createAvailableFilePath(targetPath: string): Promise<string> {
  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const base = path.basename(targetPath, extension);

  for (let index = 0; index < 200; index += 1) {
    const suffix = index === 0 ? "" : ` (${index})`;
    const candidatePath = path.join(directory, `${base}${suffix}${extension}`);
    try {
      await fsPromises.access(candidatePath);
    } catch {
      return candidatePath;
    }
  }

  throw new Error("Too many files with the same name in this folder");
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
