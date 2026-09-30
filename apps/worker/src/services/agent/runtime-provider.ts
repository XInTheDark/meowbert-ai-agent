import { readSelectedAiProvider, requireSelectedAiProvider } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import type { OpenAiProviderConfig } from "./openai-client.js";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export async function resolveRuntimeAiProvider(override?: OpenAiProviderConfig): Promise<OpenAiProviderConfig> {
  if (!override) {
    return { ...await requireSelectedAiProvider(query), supportsNativeCompaction: true };
  }
  if (override.chatGptCodex) return override;

  const selected = await readSelectedAiProvider(query);
  return {
    ...override,
    supportsNativeCompaction: selected !== null
      && normalizeBaseUrl(override.baseUrl) === normalizeBaseUrl(selected.baseUrl)
  };
}
