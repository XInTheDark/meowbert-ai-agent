import { z } from "zod";
import { requireSelectedAiProvider, type AiProviderConfig } from "./ai-providers.js";

export const DEFAULT_MEMORY_EMBEDDING_MODEL = "text-embedding-3-small";
export const MEMORY_REINDEX_DEFAULT_CONCURRENCY = 2;
export const MEMORY_REINDEX_MAX_CONCURRENCY = 32;
export const MEMORY_REINDEX_EVENT_CHANNEL = "memory_reindex_requested";

export const memoryEmbeddingSettingsInputSchema = z.object({
  providerId: z.string().uuid().nullable(),
  model: z.string().trim().min(1).max(200),
  documentTemplate: z.string().max(2000).nullable(),
  queryTemplate: z.string().max(2000).nullable()
}).strict();

export type MemoryEmbeddingSettingsInput = z.infer<typeof memoryEmbeddingSettingsInputSchema>;

export const memoryReindexInputSchema = z.object({
  concurrency: z.number().int().min(1).max(MEMORY_REINDEX_MAX_CONCURRENCY)
}).strict();

export interface AdminMemoryEmbeddingSettings extends MemoryEmbeddingSettingsInput {
  indexGeneration: number;
  updatedAt: string;
  /** The model the current indexes were built with. */
  indexedModel: string | null;
  /** True when the saved model or templates differ from what the indexes were built with. */
  indexOutdated: boolean;
}

export type MemoryReindexJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface MemoryReindexJob {
  id: string;
  status: MemoryReindexJobStatus;
  concurrency: number;
  indexGeneration: number;
  totalWorkspaces: number;
  completedWorkspaces: number;
  failedWorkspaces: number;
  activeWorkspaces: string[];
  errors: Array<{ workspace: string; message: string }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ResolvedMemoryEmbeddingSettings {
  provider: AiProviderConfig;
  model: string;
  documentTemplate: string | null;
  queryTemplate: string | null;
  indexGeneration: number;
}

type EmbeddingSettingsQuery = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// A missing provider means "follow the provider selected in Admin → AI providers".
export async function readMemoryEmbeddingSettings(query: EmbeddingSettingsQuery): Promise<ResolvedMemoryEmbeddingSettings> {
  const result = await query(
    `SELECT s.model, s.document_template, s.query_template, s.index_generation, p.base_url, p.api_key
       FROM memory_embedding_settings s
       LEFT JOIN ai_providers p ON p.id = s.provider_id
      LIMIT 1`
  );
  const row = result.rows[0] ?? {};
  const pinnedProvider = nonEmpty(row.base_url) && nonEmpty(row.api_key)
    ? { baseUrl: String(row.base_url), apiKey: String(row.api_key) }
    : null;
  const provider = pinnedProvider ?? await requireSelectedAiProvider(
    query as Parameters<typeof requireSelectedAiProvider>[0]
  );

  return {
    provider,
    model: nonEmpty(row.model)?.trim() ?? DEFAULT_MEMORY_EMBEDDING_MODEL,
    documentTemplate: nonEmpty(row.document_template),
    queryTemplate: nonEmpty(row.query_template),
    indexGeneration: typeof row.index_generation === "number" ? row.index_generation : 1
  };
}
