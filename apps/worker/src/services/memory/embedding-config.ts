import { createHash } from "node:crypto";
import { readMemoryEmbeddingSettings } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import type { ResolvedMemoryEmbeddingConfig } from "./shared.js";

// Bump when chunking or the table layout changes so every index rebuilds once.
const MEMORY_INDEX_FORMAT_VERSION = 2;

export async function resolveMemoryEmbeddingConfig(): Promise<ResolvedMemoryEmbeddingConfig> {
  const settings = await readMemoryEmbeddingSettings(query);
  const configHash = createHash("sha256")
    .update(JSON.stringify({
      formatVersion: MEMORY_INDEX_FORMAT_VERSION,
      generation: settings.indexGeneration,
      model: settings.model,
      baseUrl: settings.provider.baseUrl,
      buildPromptTemplate: settings.documentTemplate,
      queryPromptTemplate: settings.queryTemplate
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
