import type { OpenAiProviderConfig } from "@meowbert/run-executor/agent/openai-client";

// Meridian bounds one beat at 45 seconds, plus a little for the request itself.
const BEAT_REQUEST_TIMEOUT_MS = 60_000;

// What Meridian did with a beat request (see its `POST /v1/sessions/:key/cache-beat`):
// - reached: the provider read the cache, which now lives a full lifetime from the beat;
// - retry, busy: nothing ran now, so ask again shortly;
// - stop, expired, untracked, disabled: this cache cannot be kept warm.
// `unavailable` means the provider has no such endpoint or did not answer.
export type CacheBeatOutcome = "reached" | "retry" | "busy" | "stop" | "expired" | "untracked" | "disabled" | "unavailable";

const KNOWN_OUTCOMES = new Set<CacheBeatOutcome>(["reached", "retry", "busy", "stop", "expired", "untracked", "disabled"]);

export function buildCacheBeatUrl(baseUrl: string, sessionKey: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const apiRoot = base.endsWith("/v1") ? base : `${base}/v1`;
  return `${apiRoot}/sessions/${encodeURIComponent(sessionKey)}/cache-beat`;
}

export async function requestCacheBeat(provider: OpenAiProviderConfig, sessionKey: string): Promise<CacheBeatOutcome> {
  try {
    const response = await fetch(buildCacheBeatUrl(provider.baseUrl, sessionKey), {
      method: "POST",
      headers: {
        ...(provider.defaultHeaders ?? {}),
        ...(provider.apiKey.trim().length > 0 ? { authorization: `Bearer ${provider.apiKey.trim()}` } : {})
      },
      signal: AbortSignal.timeout(BEAT_REQUEST_TIMEOUT_MS)
    });
    if (response.status === 404) return "unavailable";
    if (!response.ok) return "retry";
    const body = await response.json().catch(() => null) as { outcome?: unknown } | null;
    return KNOWN_OUTCOMES.has(body?.outcome as CacheBeatOutcome) ? body?.outcome as CacheBeatOutcome : "unavailable";
  } catch {
    return "retry";
  }
}
