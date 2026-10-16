import { createHash } from "node:crypto";
import { readMemoryEmbeddingSettings } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import type { ResolvedMemoryEmbeddingConfig } from "./shared.js";

// Bump when chunking or the table layout changes so every index rebuilds once.
const MEMORY_INDEX_FORMAT_VERSION = 3;

// Indexes rebuild only when the format changes or an admin re-embeds from Admin → Embeddings
// (which bumps the generation). Saving a new provider, model, or template never re-embeds.

export async function resolveMemoryEmbeddingConfig(): Promise<ResolvedMemoryEmbeddingConfig> {
  const settings = await readMemoryEmbeddingSettings(query);
  const configHash = createHash("sha256")
    .update(JSON.stringify({
      formatVersion: MEMORY_INDEX_FORMAT_VERSION,
      generation: settings.indexGeneration
    }))
    .digest("hex");

  return {
    provider: settings.provider,
    model: settings.model,
    buildPromptTemplate: settings.documentTemplate,
    queryPromptTemplate: settings.queryTemplate,
    configHash
  };
}
