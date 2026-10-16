import path from "node:path";
import { MatchQuery, rerankers, type Table } from "@lancedb/lancedb";
import { isWithinPath, PROJECT_MEMORY_PARENT_DIRNAME, WORKSPACE_MEMORY_DIRNAME } from "@meowbert/shared";
import { resolveMemoryEmbeddingConfig } from "./embedding-config.js";
import { applyEmbeddingTemplate, embedTexts } from "./indexing.js";
import {
  getWorkspaceMemoryPaths,
  MEMORY_SEARCH_TEXT_COLUMN,
  readMemoryManifest,
  type MemorySearchResult,
  type MemorySearchScope
} from "./shared.js";
import { openMemoryConnection, openMemoryTable, readMemorySyncStatus } from "./storage.js";
import { ensureWorkspaceMemoryWatcher, syncWorkspaceMemoryNow } from "./watcher.js";

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeSqlLike(value: string): string {
  return escapeSqlString(value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_"));
}

function buildRelativePathPrefixPredicate(relativePathPrefix: string): string {
  return `relative_path LIKE '${escapeSqlLike(relativePathPrefix)}%' ESCAPE '\\'`;
}

function buildRelativePathTargetPredicate(relativePath: string): string {
  const normalized = relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
  return `(relative_path = '${escapeSqlString(relativePath.replace(/\/$/, ""))}' OR ${buildRelativePathPrefixPredicate(normalized)})`;
}

function normalizeMemorySearchPath(rawPath: string, memoryDir: string): string | null {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const resolvedMemoryDir = path.resolve(memoryDir);
  const relativeCandidate = path.isAbsolute(trimmed)
    ? path.relative(resolvedMemoryDir, path.resolve(trimmed))
    : trimmed;
  if (!isWithinPath(resolvedMemoryDir, path.resolve(resolvedMemoryDir, trimmed))) {
    return null;
  }

  const normalized = relativeCandidate.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === "..")) {
    return null;
  }

  const memoryRelativePath = normalized === WORKSPACE_MEMORY_DIRNAME || normalized.startsWith(`${WORKSPACE_MEMORY_DIRNAME}/`)
    ? normalized
    : `${WORKSPACE_MEMORY_DIRNAME}/${normalized}`;
  return memoryRelativePath.endsWith("/") ? memoryRelativePath : memoryRelativePath.replace(/\/+$/, "");
}

function buildScopePredicate(scope: MemorySearchScope, currentProjectId?: string | null): string | null {
  if (scope === "current_project") {
    if (!currentProjectId || currentProjectId.trim().length === 0) {
      return "1 = 0";
    }
    return buildRelativePathPrefixPredicate(`${WORKSPACE_MEMORY_DIRNAME}/${PROJECT_MEMORY_PARENT_DIRNAME}/${currentProjectId}/`);
  }

  if (scope === "workspace") {
    return `relative_path NOT LIKE '${escapeSqlLike(`${WORKSPACE_MEMORY_DIRNAME}/${PROJECT_MEMORY_PARENT_DIRNAME}/`)}%' ESCAPE '\\'`;
  }

  return null;
}

function buildPathsPredicate(paths: string[] | null | undefined, memoryDir: string): string | null {
  if (!paths || paths.length === 0) {
    return null;
  }

  const predicates = paths
    .map((rawPath) => normalizeMemorySearchPath(rawPath, memoryDir))
    .filter((value): value is string => value !== null)
    .map(buildRelativePathTargetPredicate);

  if (predicates.length === 0) {
    return "1 = 0";
  }

  return `(${predicates.join(" OR ")})`;
}

function buildMemorySearchPredicate(input: {
  scope: MemorySearchScope;
  memoryDir: string;
  paths?: string[] | null;
  currentProjectId?: string | null;
}): string | null {
  const predicates = [
    buildScopePredicate(input.scope, input.currentProjectId),
    buildPathsPredicate(input.paths, input.memoryDir)
  ].filter((value): value is string => value !== null);

  if (predicates.length === 0) {
    return null;
  }

  return predicates.map((predicate) => `(${predicate})`).join(" AND ");
}

const RESULT_COLUMNS = ["id", "text", "file_path", "relative_path", "line_start", "line_end"];
let rrfReranker: Promise<rerankers.RRFReranker> | null = null;

// Higher is always better: RRF relevance for hybrid results, cosine similarity for vector-only.
function readScore(row: Record<string, unknown>): number {
  if (typeof row._relevance_score === "number") {
    return row._relevance_score;
  }
  return typeof row._distance === "number" ? 1 - row._distance : 0;
}

// Hybrid search: keyword (BM25) and vector results merged with Reciprocal Rank Fusion, so exact
// names and commands match even when embeddings miss them. Falls back to vector-only when the
// keyword index is unavailable.
async function runMemoryQuery(input: {
  table: Table;
  queryVector: number[];
  queryText: string;
  predicate: string | null;
  limit: number;
}): Promise<Array<Record<string, unknown>>> {
  const vectorQuery = () => {
    const query = input.table.vectorSearch(input.queryVector).distanceType("cosine").limit(input.limit);
    return input.predicate ? query.where(input.predicate) : query;
  };

  try {
    rrfReranker ??= rerankers.RRFReranker.create();
    return await vectorQuery()
      .fullTextSearch(new MatchQuery(input.queryText, MEMORY_SEARCH_TEXT_COLUMN))
      .rerank(await rrfReranker)
      .select(RESULT_COLUMNS)
      .toArray();
  } catch (error) {
    console.warn(`[memory] Hybrid search unavailable, using vector search: ${error instanceof Error ? error.message : String(error)}`);
    return vectorQuery().select(RESULT_COLUMNS).toArray();
  }
}

export async function searchMemoryIndex(input: {
  workspaceRoot: string;
  currentProjectId?: string | null;
  query: string;
  limit: number;
  scope?: MemorySearchScope | null;
  paths?: string[] | null;
}): Promise<MemorySearchResult> {
  ensureWorkspaceMemoryWatcher(input.workspaceRoot);

  const paths = getWorkspaceMemoryPaths(input.workspaceRoot);
  const embeddingConfig = await resolveMemoryEmbeddingConfig();
  let manifest = await readMemoryManifest(paths);
  if (manifest?.embedding_config_hash !== embeddingConfig.configHash) {
    await syncWorkspaceMemoryNow(input.workspaceRoot);
    manifest = await readMemoryManifest(paths);
  }
  const syncStatus = await readMemorySyncStatus(input.workspaceRoot);
  if (manifest?.embedding_config_hash !== embeddingConfig.configHash) {
    return { sync_status: syncStatus, items: [] };
  }
  const connection = await openMemoryConnection(paths);
  try {
    const table = await openMemoryTable(connection);
    if (!table) {
      return {
        sync_status: syncStatus,
        items: []
      };
    }

    const queryText = applyEmbeddingTemplate(embeddingConfig.queryPromptTemplate, input.query);
    const [queryVector] = await embedTexts([queryText], embeddingConfig);
    const predicate = buildMemorySearchPredicate({
      scope: input.scope ?? "all",
      memoryDir: paths.memoryDir,
      paths: input.paths,
      currentProjectId: input.currentProjectId
    });
    const rows = await runMemoryQuery({ table, queryVector, queryText: input.query, predicate, limit: input.limit });

    return {
      sync_status: syncStatus,
      items: rows.map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        score: readScore(row),
        text: typeof row.text === "string" ? row.text : "",
        file_path: typeof row.file_path === "string" ? row.file_path : "",
        relative_path: typeof row.relative_path === "string" ? row.relative_path : "",
        line_start: typeof row.line_start === "number" ? row.line_start : null,
        line_end: typeof row.line_end === "number" ? row.line_end : null
      }))
    };
  } finally {
    connection.close();
  }
}
