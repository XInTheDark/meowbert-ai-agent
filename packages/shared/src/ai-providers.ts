import { z } from "zod";

export const aiProviderInputSchema = z.object({
  baseUrl: z.string().trim().url().max(2048).refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:")
        && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS base URL without credentials, a query, or a fragment."),
  apiKey: z.string().trim().min(1).max(4096)
}).strict();

export type AiProviderConfig = z.infer<typeof aiProviderInputSchema>;

export interface AdminAiProvider {
  id: string;
  baseUrl: string;
  selected: boolean;
}

type ProviderQuery = (sql: string) => Promise<{
  rows: Array<{ base_url: string; api_key: string }>;
}>;

export async function readSelectedAiProvider(query: ProviderQuery): Promise<AiProviderConfig | null> {
  const result = await query("SELECT base_url, api_key FROM ai_providers WHERE is_selected = true LIMIT 1");
  const row = result.rows[0];
  return row ? { baseUrl: row.base_url, apiKey: row.api_key } : null;
}

export async function requireSelectedAiProvider(query: ProviderQuery): Promise<AiProviderConfig> {
  const provider = await readSelectedAiProvider(query);
  if (!provider) {
    throw new Error("No AI provider selected. Add and select a provider in Admin → AI providers.");
  }
  return provider;
}
