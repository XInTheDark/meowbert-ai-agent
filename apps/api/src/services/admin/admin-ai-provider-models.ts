import type { AiProviderConfig } from "@meowbert/shared";

const LIST_MODELS_TIMEOUT_MS = 15_000;

export class ProviderModelListError extends Error {}

function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function readModelIds(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ProviderModelListError("The provider's /models response did not include a model list.");
  }

  const ids = data
    .map((entry) => (entry as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

// Lists models through the provider's OpenAI-compatible GET /models endpoint.
// A successful call also confirms the base URL and API key work.
export async function listProviderModels(
  provider: AiProviderConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchImpl(modelsUrl(provider.baseUrl), {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProviderModelListError(`Could not reach the provider: ${reason}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderModelListError("The provider rejected the API key.");
  }
  if (!response.ok) {
    throw new ProviderModelListError(`The provider returned HTTP ${response.status} for /models.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProviderModelListError("The provider's /models response was not valid JSON.");
  }
  return readModelIds(body);
}
