import path from "node:path";
import { z } from "zod";

export const LEGACY_LOCAL_STORAGE_BACKEND_ID = "local-default";
export const STORAGE_BACKEND_TYPE_VALUES = ["local", "mounted"] as const;
export type StorageBackendType = (typeof STORAGE_BACKEND_TYPE_VALUES)[number];
export const DEFAULT_XFS_PROJECT_ID_BASE = 10_000;

const backendBaseSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160).optional()
});

const optionalSubdirSchema = z.string().trim().min(1).max(240).optional();
const xfsProjectQuotaSchema = z.object({
  mountPath: z.string().min(1),
  projectIdBase: z.number().int().positive().max(2_147_483_647).default(DEFAULT_XFS_PROJECT_ID_BASE),
  command: z.string().trim().min(1).max(240).optional()
});

const localStorageBackendSchema = backendBaseSchema.extend({
  type: z.literal("local"),
  workspacesRoot: z.string().min(1),
  environmentsRoot: z.string().min(1),
  xfsProjectQuota: xfsProjectQuotaSchema.optional()
});

const mountedStorageBackendSchema = backendBaseSchema.extend({
  type: z.literal("mounted"),
  mountPath: z.string().min(1),
  workspacesDir: optionalSubdirSchema,
  environmentsDir: optionalSubdirSchema
});

export const storageBackendSchema = z.discriminatedUnion("type", [
  localStorageBackendSchema,
  mountedStorageBackendSchema
]);

export const storageConfigSchema = z.object({
  defaultWorkspaceBackendId: z.string().trim().min(1).max(120).optional(),
  backends: z.array(storageBackendSchema).max(100).optional()
}).optional();

export type StorageBackendConfig = z.infer<typeof storageBackendSchema>;
export type LocalStorageBackendConfig = z.infer<typeof localStorageBackendSchema>;
export type MountedStorageBackendConfig = z.infer<typeof mountedStorageBackendSchema>;
export type RawStorageConfig = z.infer<typeof storageConfigSchema>;
export type XfsProjectQuotaConfig = z.infer<typeof xfsProjectQuotaSchema>;

export interface NormalizedStorageConfig {
  defaultWorkspaceBackendId: string;
  backends: StorageBackendConfig[];
}

export const WORKSPACE_STORAGE_MIGRATION_STATUS_VALUES = ["queued", "running", "failed", "completed", "cancelled"] as const;
export type WorkspaceStorageMigrationStatus = (typeof WORKSPACE_STORAGE_MIGRATION_STATUS_VALUES)[number];

function resolvePathFromRoot(root: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(root, maybeRelative);
}

function normalizeBackendPaths(baseDir: string, backend: StorageBackendConfig): StorageBackendConfig {
  if (backend.type === "local") {
    return {
      ...backend,
      workspacesRoot: resolvePathFromRoot(baseDir, backend.workspacesRoot),
      environmentsRoot: resolvePathFromRoot(baseDir, backend.environmentsRoot),
      ...(backend.xfsProjectQuota
        ? {
            xfsProjectQuota: {
              ...backend.xfsProjectQuota,
              mountPath: resolvePathFromRoot(baseDir, backend.xfsProjectQuota.mountPath)
            }
          }
        : {})
    };
  }

  return {
    ...backend,
    mountPath: resolvePathFromRoot(baseDir, backend.mountPath)
  };
}

function assertUniqueBackendIds(backends: StorageBackendConfig[]): void {
  const seen = new Set<string>();
  for (const backend of backends) {
    if (seen.has(backend.id)) {
      throw new Error(`Duplicate storage backend id: ${backend.id}`);
    }
    seen.add(backend.id);
  }
}

export function createLegacyLocalStorageBackend(input: {
  workspacesRoot: string;
  environmentsRoot: string;
}): LocalStorageBackendConfig {
  return {
    id: LEGACY_LOCAL_STORAGE_BACKEND_ID,
    label: "Local (legacy)",
    type: "local",
    workspacesRoot: path.resolve(input.workspacesRoot),
    environmentsRoot: path.resolve(input.environmentsRoot)
  };
}

export function normalizeStorageConfig(input: {
  baseDir: string;
  workspacesRoot: string;
  environmentsRoot: string;
  rawStorage?: RawStorageConfig;
}): NormalizedStorageConfig {
  const normalizedConfiguredBackends = (input.rawStorage?.backends ?? []).map((backend) =>
    normalizeBackendPaths(input.baseDir, backend)
  );
  assertUniqueBackendIds(normalizedConfiguredBackends);

  const legacyLocalBackend = createLegacyLocalStorageBackend({
    workspacesRoot: input.workspacesRoot,
    environmentsRoot: input.environmentsRoot
  });

  const backends = normalizedConfiguredBackends.some((backend) => backend.id === LEGACY_LOCAL_STORAGE_BACKEND_ID)
    ? normalizedConfiguredBackends
    : [legacyLocalBackend, ...normalizedConfiguredBackends];

  const defaultWorkspaceBackendId = input.rawStorage?.defaultWorkspaceBackendId?.trim() || LEGACY_LOCAL_STORAGE_BACKEND_ID;
  if (!backends.some((backend) => backend.id === defaultWorkspaceBackendId)) {
    throw new Error(`Configured default storage backend not found: ${defaultWorkspaceBackendId}`);
  }

  return {
    defaultWorkspaceBackendId,
    backends
  };
}

export function findStorageBackendById(storage: NormalizedStorageConfig, backendId: string): StorageBackendConfig | null {
  return storage.backends.find((backend) => backend.id === backendId) ?? null;
}

export function getStorageBackendLabel(backend: StorageBackendConfig): string {
  if (typeof backend.label === "string" && backend.label.trim().length > 0) {
    return backend.label.trim();
  }

  if (backend.type === "local") {
    return backend.id === LEGACY_LOCAL_STORAGE_BACKEND_ID ? "Local (legacy)" : `Local (${backend.id})`;
  }
  return `Mounted path (${backend.id})`;
}

function resolveProviderWorkspaceBaseDir(backend: StorageBackendConfig): string {
  if (backend.type === "local") {
    return backend.workspacesRoot;
  }

  return path.resolve(backend.mountPath, backend.workspacesDir ?? "workspaces");
}

function resolveWorkspaceStorageUnitRootForBackend(backend: StorageBackendConfig, workspaceId: string): string {
  return path.resolve(resolveProviderWorkspaceBaseDir(backend), workspaceId);
}

function resolveWorkspaceEnvironmentBaseDirForBackend(backend: StorageBackendConfig, workspaceId: string): string {
  const environmentsDir = backend.type === "local" ? "environments" : (backend.environmentsDir ?? "environments");
  return path.resolve(resolveWorkspaceStorageUnitRootForBackend(backend, workspaceId), environmentsDir);
}

export function resolveWorkspaceStorageRootForBackend(backend: StorageBackendConfig, workspaceId: string): string {
  return path.resolve(resolveWorkspaceStorageUnitRootForBackend(backend, workspaceId), "root");
}

export function resolveEnvironmentStorageRootForBackend(
  backend: StorageBackendConfig,
  workspaceId: string,
  environmentId: string
): string {
  return path.resolve(resolveWorkspaceEnvironmentBaseDirForBackend(backend, workspaceId), environmentId, "root");
}
