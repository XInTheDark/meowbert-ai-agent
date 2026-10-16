import {
  MEMORY_REINDEX_EVENT_CHANNEL,
  memoryEmbeddingSettingsInputSchema,
  memoryReindexInputSchema,
  type AdminMemoryEmbeddingSettings,
  type MemoryEmbeddingSettingsInput,
  type MemoryReindexJob
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { redis } from "../../lib/redis.js";

interface SettingsRow {
  provider_id: string | null;
  model: string;
  document_template: string | null;
  query_template: string | null;
  index_generation: number;
  updated_at: Date;
}

interface JobRow {
  id: string;
  status: MemoryReindexJob["status"];
  concurrency: number;
  index_generation: number;
  total_workspaces: number;
  completed_workspaces: number;
  failed_workspaces: number;
  active_workspaces_json: string[];
  errors_json: MemoryReindexJob["errors"];
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

function inputError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true });
}

function mapSettings(row: SettingsRow): AdminMemoryEmbeddingSettings {
  return {
    providerId: row.provider_id,
    model: row.model,
    documentTemplate: row.document_template,
    queryTemplate: row.query_template,
    indexGeneration: row.index_generation,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapJob(row: JobRow): MemoryReindexJob {
  return {
    id: row.id,
    status: row.status,
    concurrency: row.concurrency,
    indexGeneration: row.index_generation,
    totalWorkspaces: row.total_workspaces,
    completedWorkspaces: row.completed_workspaces,
    failedWorkspaces: row.failed_workspaces,
    activeWorkspaces: row.active_workspaces_json,
    errors: row.errors_json,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null
  };
}

export async function getMemoryEmbeddingSettings(): Promise<AdminMemoryEmbeddingSettings> {
  const result = await query<SettingsRow>("SELECT * FROM memory_embedding_settings LIMIT 1");
  if (!result.rows[0]) {
    throw new Error("Memory embedding settings are missing. Run the database migrations.");
  }
  return mapSettings(result.rows[0]);
}

export async function updateMemoryEmbeddingSettings(raw: MemoryEmbeddingSettingsInput): Promise<AdminMemoryEmbeddingSettings> {
  const input = memoryEmbeddingSettingsInputSchema.parse(raw);
  if (input.providerId) {
    const provider = await query("SELECT 1 FROM ai_providers WHERE id = $1", [input.providerId]);
    if (!provider.rowCount) {
      throw inputError("AI provider not found.", 404);
    }
  }
  const result = await query<SettingsRow>(
    `UPDATE memory_embedding_settings
        SET provider_id = $1, model = $2, document_template = $3, query_template = $4, updated_at = now()
      RETURNING *`,
    [input.providerId, input.model, input.documentTemplate?.trim() || null, input.queryTemplate?.trim() || null]
  );
  return mapSettings(result.rows[0]);
}

export async function getLatestMemoryReindexJob(): Promise<MemoryReindexJob | null> {
  const result = await query<JobRow>("SELECT * FROM memory_reindex_jobs ORDER BY created_at DESC LIMIT 1");
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

// Bumping the generation invalidates every Memory index on every worker; the job then rebuilds
// them eagerly, and any index it misses rebuilds on its next sync or search.
export async function startMemoryReindex(raw: { concurrency: number }, userId: string): Promise<MemoryReindexJob> {
  const input = memoryReindexInputSchema.parse(raw);
  const job = await withTransaction(async (client) => {
    const active = await client.query("SELECT 1 FROM memory_reindex_jobs WHERE status IN ('queued', 'running') FOR UPDATE");
    if (active.rowCount) {
      throw inputError("A re-index is already in progress.", 409);
    }
    const settings = await client.query<{ index_generation: number }>(
      `UPDATE memory_embedding_settings SET index_generation = index_generation + 1, updated_at = now()
       RETURNING index_generation`
    );
    const inserted = await client.query<JobRow>(
      `INSERT INTO memory_reindex_jobs (concurrency, index_generation, requested_by_user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.concurrency, settings.rows[0].index_generation, userId]
    );
    return mapJob(inserted.rows[0]);
  });
  await redis.publish(MEMORY_REINDEX_EVENT_CHANNEL, JSON.stringify({ jobId: job.id })).catch((error) => {
    console.error("Unable to publish memory re-index event", error);
  });
  return job;
}

export async function cancelMemoryReindex(): Promise<MemoryReindexJob | null> {
  await query(
    `UPDATE memory_reindex_jobs
        SET status = 'cancelled', finished_at = now(), active_workspaces_json = '[]'::jsonb, updated_at = now()
      WHERE status IN ('queued', 'running')`
  );
  return getLatestMemoryReindexJob();
}
