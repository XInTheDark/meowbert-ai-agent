import {
  MEMORY_REINDEX_EVENT_CHANNEL,
  memoryEmbeddingSettingsInputSchema,
  memoryReindexInputSchema,
  type AdminMemoryEmbeddingSettings,
  type MemoryEmbeddingSettingsInput,
  type MemoryReindexJob
} from "@meowbert/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { redis } from "../../lib/redis.js";

interface SettingsRow {
  provider_id: string | null;
  model: string;
  document_template: string | null;
  query_template: string | null;
  index_generation: number;
  indexed_settings_json: { model?: string; documentTemplate?: string | null; queryTemplate?: string | null } | null;
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

function isIndexOutdated(row: SettingsRow): boolean {
  const indexed = row.indexed_settings_json;
  if (!indexed) {
    return false;
  }
  return indexed.model !== row.model
    || (indexed.documentTemplate ?? null) !== row.document_template
    || (indexed.queryTemplate ?? null) !== row.query_template;
}

function mapSettings(row: SettingsRow): AdminMemoryEmbeddingSettings {
  return {
    providerId: row.provider_id,
    model: row.model,
    documentTemplate: row.document_template,
    queryTemplate: row.query_template,
    indexGeneration: row.index_generation,
    updatedAt: row.updated_at.toISOString(),
    indexedModel: row.indexed_settings_json?.model ?? null,
    indexOutdated: isIndexOutdated(row)
  };
}

// Bumping the generation makes every Memory index stale on every worker; each one re-embeds with
// the saved settings the next time it syncs or is searched. Records what the new indexes use.
async function bumpIndexGeneration(client: PoolClient): Promise<SettingsRow> {
  const active = await client.query("SELECT 1 FROM memory_reindex_jobs WHERE status IN ('queued', 'running') FOR UPDATE");
  if (active.rowCount) {
    throw inputError("A re-index is already in progress.", 409);
  }
  const result = await client.query<SettingsRow>(
    `UPDATE memory_embedding_settings
        SET index_generation = index_generation + 1,
            indexed_settings_json = jsonb_build_object(
              'model', model, 'documentTemplate', document_template, 'queryTemplate', query_template
            ),
            updated_at = now()
      RETURNING *`
  );
  return result.rows[0];
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

export async function markMemoryIndexesForReembed(): Promise<AdminMemoryEmbeddingSettings> {
  return mapSettings(await withTransaction(bumpIndexGeneration));
}

// Same as the lazy re-embed, but a job then rebuilds every workspace now instead of on next use.
export async function startMemoryReindex(raw: { concurrency: number }, userId: string): Promise<MemoryReindexJob> {
  const input = memoryReindexInputSchema.parse(raw);
  const job = await withTransaction(async (client) => {
    const settings = await bumpIndexGeneration(client);
    const inserted = await client.query<JobRow>(
      `INSERT INTO memory_reindex_jobs (concurrency, index_generation, requested_by_user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.concurrency, settings.index_generation, userId]
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
