import type { OpenAiProviderConfig } from "@meowbert/run-executor/agent/openai-client";
import { query } from "../../lib/db.js";
import { resolveRuntimeAiProvider } from "../agent/runtime-provider.js";

// Where beats go: the provider the admin picked for them, or the selected provider when none is
// picked or the picked one was removed.
export async function resolveCachebeatProvider(providerId: string | null): Promise<OpenAiProviderConfig> {
  if (providerId) {
    const result = await query<{ base_url: string; api_key: string }>(
      "SELECT base_url, api_key FROM ai_providers WHERE id = $1",
      [providerId]
    );
    const row = result.rows[0];
    if (row) return { baseUrl: row.base_url, apiKey: row.api_key };
  }
  return resolveRuntimeAiProvider();
}
