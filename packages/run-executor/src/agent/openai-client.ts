import OpenAI from "openai";
import { sanitizeOpenAiEventStreamResponse } from "./openai-event-stream-sanitizer.js";

export interface OpenAiProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  chatGptCodex?: boolean;
  supportsNativeCompaction?: boolean;
}

const clientCache = new Map<string, OpenAI>();
const defaultOpenAiFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  return sanitizeOpenAiEventStreamResponse(response);
};

export function getOpenAiClient(provider: OpenAiProviderConfig): OpenAI {
  const apiKey = provider.apiKey.trim();
  const baseUrl = provider.baseUrl.trim();
  const headers = provider.defaultHeaders ?? {};
  const headersKey = Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const cacheKey = `${baseUrl}::${apiKey}::${headersKey}`;

  const existing = clientCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    defaultHeaders: Object.keys(headers).length > 0 ? headers : undefined,
    timeout: 30 * 60 * 1000,
    fetch: defaultOpenAiFetch
  });

  clientCache.set(cacheKey, client);
  return client;
}
