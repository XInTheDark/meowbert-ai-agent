import { createHash, randomUUID } from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { config } from "../../lib/config.js";
import { getWorkspaceMemoryDir } from "@meowbert/run-executor/memory/main-files";

export {
  buildWorkspaceMemoryEnvVars,
  ensureProjectMemoryDir,
  ensureWorkspaceMemoryDir,
  MEMORY_MAIN_FILE_PROMPT_MAX_CHARS,
  readProjectMemoryMainFile,
  readWorkspaceMemoryMainFile,
  type MemoryMainFile
} from "@meowbert/run-executor/memory/main-files";

export const MEMORY_TABLE_NAME = "memory_chunks_v2";
export const LEGACY_MEMORY_TABLE_NAMES = ["memory_chunks_v1"];
export const MEMORY_SEARCH_TEXT_COLUMN = "search_text";
export const MEMORY_STATUS_FILENAME = "status.json";
export const MEMORY_MANIFEST_FILENAME = "manifest.json";
export const MEMORY_BINARY_SAMPLE_BYTES = 8 * 1024;
export const MEMORY_CHUNK_SIZE = 1200;
export const MEMORY_CHUNK_OVERLAP = 200;
export const MEMORY_EMBED_BATCH_SIZE = 64;
export const MEMORY_INDEX_DEBOUNCE_MS = 500;
export const MEMORY_INDEX_MIN_ROWS = 32;
export const MEMORY_OPTIMIZE_MIN_INTERVAL_MS = 60_000;
const MEMORY_CACHE_LAYOUT_VERSION = "v1";
const MEMORY_CACHE_INDEX_DIRNAME = "memory-index";

export type MemorySyncState = "ready" | "indexing" | "error";
export type MemorySearchTargetKind = "lancedb" | "none";

export interface PersistedMemoryFileRecord {
  sha256: string;
  sizeBytes: number;
  modifiedAtMs: number;
  // When the hash was computed. Older manifests lack it, which makes the next scan re-hash.
  hashedAtMs?: number;
}

export interface MemoryTrackedFile extends PersistedMemoryFileRecord {
  absolutePath: string;
  relativePath: string;
}

export interface MemoryManifest {
  embedding_config_hash: string;
  files: Record<string, PersistedMemoryFileRecord>;
  updated_at: string;
}

export interface MemorySyncStatus {
  state: MemorySyncState;
  search_target: MemorySearchTargetKind;
  active_generation: string | null;
  detail: string | null;
  error: string | null;
  last_started_at: string | null;
  last_successful_at: string | null;
  updated_at: string | null;
}

export interface MemorySearchResultItem {
  id: string;
  score: number;
  text: string;
  file_path: string;
  relative_path: string;
  line_start: number | null;
  line_end: number | null;
}

export interface MemorySearchResult {
  sync_status: MemorySyncStatus;
  items: MemorySearchResultItem[];
}

export type MemorySearchScope = "all" | "workspace" | "current_project";

export interface WorkspaceMemoryPaths {
  memoryDir: string;
  indexDir: string;
  dbDir: string;
  statusPath: string;
  manifestPath: string;
}

export interface ResolvedMemoryEmbeddingConfig {
  provider: import("@meowbert/run-executor/agent/openai-client").OpenAiProviderConfig;
  model: string;
  buildPromptTemplate: string | null;
  queryPromptTemplate: string | null;
  configHash: string;
}

export interface MemoryChunk {
  id: string;
  text: string;
  context: string;
  filePath: string;
  relativePath: string;
  lineStart: number;
  lineEnd: number;
}

export interface MemoryIndexRow {
  [key: string]: unknown;
  id: string;
  text: string;
  search_text: string;
  file_path: string;
  relative_path: string;
  line_start: number;
  line_end: number;
  vector: number[];
}

export function getWorkspaceMemoryPaths(workspaceRoot: string): WorkspaceMemoryPaths {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const cacheDir = path.resolve(
    resolveMemoryIndexCacheRoot(),
    MEMORY_CACHE_LAYOUT_VERSION,
    createWorkspaceMemoryCacheKey(resolvedWorkspaceRoot)
  );
  const indexDir = path.resolve(cacheDir, MEMORY_CACHE_INDEX_DIRNAME);
  return {
    memoryDir: getWorkspaceMemoryDir(resolvedWorkspaceRoot),
    indexDir,
    dbDir: path.resolve(indexDir, "lancedb"),
    statusPath: path.resolve(indexDir, MEMORY_STATUS_FILENAME),
    manifestPath: path.resolve(indexDir, MEMORY_MANIFEST_FILENAME)
  };
}

function createWorkspaceMemoryCacheKey(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex");
}

function resolveMemoryIndexCacheRoot(): string {
  const memoryConfig = config.memory as { indexCacheRoot?: string } | undefined;
  return memoryConfig?.indexCacheRoot ?? path.resolve(config.runtime.tasksRoot, "..", "memory-index-cache");
}

export function createMemorySyncStatus(input: {
  state: MemorySyncState;
  searchTarget: MemorySearchTargetKind;
  detail?: string | null;
  error?: string | null;
  lastStartedAt?: string | null;
  lastSuccessfulAt?: string | null;
}): MemorySyncStatus {
  return {
    state: input.state,
    search_target: input.searchTarget,
    active_generation: null,
    detail: input.detail ?? null,
    error: input.error ?? null,
    last_started_at: input.lastStartedAt ?? null,
    last_successful_at: input.lastSuccessfulAt ?? null,
    updated_at: new Date().toISOString()
  };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function pathExists(targetPath: string): Promise<boolean> {
  return fsPromises.access(targetPath).then(() => true).catch(() => false);
}

export async function writeJsonFileAtomic(filePath: string, payload: unknown): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fsPromises.writeFile(tempPath, JSON.stringify(payload, null, 2));
  await fsPromises.rename(tempPath, filePath);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  const raw = await fsPromises.readFile(filePath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readPersistedStatus(paths: WorkspaceMemoryPaths): Promise<MemorySyncStatus | null> {
  const status = await readJsonFile<MemorySyncStatus>(paths.statusPath);
  if (!status || typeof status.state !== "string" || typeof status.search_target !== "string") {
    return null;
  }
  return status;
}

export async function writeMemorySyncStatus(paths: WorkspaceMemoryPaths, status: MemorySyncStatus): Promise<void> {
  await writeJsonFileAtomic(paths.statusPath, status);
}

export async function readMemoryManifest(paths: WorkspaceMemoryPaths): Promise<MemoryManifest | null> {
  const manifest = await readJsonFile<MemoryManifest>(paths.manifestPath);
  if (!manifest || typeof manifest.embedding_config_hash !== "string" || !isPlainObject(manifest.files)) {
    return null;
  }
  return manifest;
}

export async function writeMemoryManifest(
  paths: WorkspaceMemoryPaths,
  files: MemoryTrackedFile[],
  configHash: string
): Promise<void> {
  const manifest: MemoryManifest = {
    embedding_config_hash: configHash,
    files: Object.fromEntries(
      files.map((file) => [
        file.relativePath,
        {
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
          modifiedAtMs: file.modifiedAtMs,
          hashedAtMs: file.hashedAtMs
        }
      ])
    ),
    updated_at: nowIso()
  };
  await writeJsonFileAtomic(paths.manifestPath, manifest);
}

