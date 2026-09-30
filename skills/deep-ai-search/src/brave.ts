import type { DeepAiSearchConfig } from './config.js';
import { writeIoLog } from './io-log.js';
import pLimit from 'p-limit';

export interface BraveWebResult {
  title?: string;
  url: string;
  description?: string;
  age?: string;
  language?: string;
}

export interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

export interface BraveSearchOptions {
  count: number;
  // Pass-through query params supported by Brave Search API (e.g. freshness, country, search_lang, ui_lang).
  params?: Record<string, string | number | boolean | undefined>;
}

interface BraveKeyState {
  cooldownUntilMs: number;
  consecutive429: number;
}

const braveKeyStates = new Map<number, BraveKeyState>();
let braveRoundRobinIndex = 0;

let braveGlobalLimiter: ReturnType<typeof pLimit> | null = null;
let braveGlobalLimiterConcurrency = 0;

function getBraveGlobalLimiter(concurrency: number): ReturnType<typeof pLimit> {
  const c = Math.max(1, Math.floor(concurrency));
  if (!braveGlobalLimiter || braveGlobalLimiterConcurrency !== c) {
    braveGlobalLimiterConcurrency = c;
    braveGlobalLimiter = pLimit(c);
  }
  return braveGlobalLimiter;
}

function effectiveBraveConcurrency(config: DeepAiSearchConfig): number {
  // If you only have 1 API key, higher concurrency just increases 429s.
  return Math.max(1, Math.min(config.brave.maxConcurrency, config.brave.apiKeys.length));
}

function getKeyState(index: number): BraveKeyState {
  const existing = braveKeyStates.get(index);
  if (existing) return existing;
  const created: BraveKeyState = { cooldownUntilMs: 0, consecutive429: 0 };
  braveKeyStates.set(index, created);
  return created;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

function pickBraveKey(keys: string[]): { key: string; index: number; waitMs: number } {
  const now = Date.now();
  const start = braveRoundRobinIndex % keys.length;

  // Find any non-cooling key (RR order), otherwise pick the one that becomes available
  // the soonest and tell the caller how long to wait.
  let bestIndex = start;
  let bestUntil = Infinity;

  for (let i = 0; i < keys.length; i += 1) {
    const idx = (start + i) % keys.length;
    const st = getKeyState(idx);
    if (st.cooldownUntilMs <= now) {
      braveRoundRobinIndex = idx + 1;
      return { key: keys[idx]!, index: idx, waitMs: 0 };
    }
    if (st.cooldownUntilMs < bestUntil) {
      bestUntil = st.cooldownUntilMs;
      bestIndex = idx;
    }
  }

  braveRoundRobinIndex = bestIndex + 1;
  return { key: keys[bestIndex]!, index: bestIndex, waitMs: Math.max(0, bestUntil - now) };
}

const ALLOWED_PARAM_KEYS = new Set([
  'country',
  'search_lang',
  'ui_lang',
  'safesearch',
  'freshness',
  'spellcheck',
  'text_decorations',
  'result_filter'
]);

function normalizeBraveParamValue(key: string, value: string | number | boolean): string | undefined {
  // Brave expects certain query params to follow specific formats.
  // We normalize a few common ones here to reduce "422 VALIDATION" errors.
  if (key === 'country') {
    if (typeof value !== 'string') return undefined;
    const v = value.trim().toUpperCase();
    // Brave expects an ISO-3166 alpha-2 country code from an allowlist. We can't
    // hardcode the whole list, but we can at least enforce the common shape.
    if (!/^[A-Z]{2}$/.test(v)) return undefined;
    return v;
  }

  if (key === 'search_lang' || key === 'ui_lang') {
    if (typeof value !== 'string') return undefined;
    const v = value.trim().toLowerCase();
    if (!v) return undefined;
    return v;
  }

  if (key === 'safesearch') {
    if (typeof value !== 'string') return String(value);
    return value.trim().toLowerCase();
  }

  return String(value);
}

function extractInvalidQueryParamKeysFrom422(bodyText: string): string[] {
  try {
    const parsed = JSON.parse(bodyText) as any;
    const errors: any[] | undefined = parsed?.error?.meta?.errors;
    if (!Array.isArray(errors)) return [];

    const keys: string[] = [];
    for (const e of errors) {
      const loc: unknown = e?.loc;
      if (!Array.isArray(loc)) continue;
      // Brave uses loc like ["query","country"].
      if (loc.length >= 2 && loc[0] === 'query' && typeof loc[1] === 'string') {
        keys.push(loc[1]);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;

  // Retry-After can be seconds or an HTTP date.
  if (/^\d+$/.test(v)) {
    return Number(v) * 1000;
  }
  const at = Date.parse(v);
  if (!Number.isNaN(at)) {
    return Math.max(0, at - Date.now());
  }
  return undefined;
}

export async function braveWebSearch(
  query: string,
  options: BraveSearchOptions,
  config: DeepAiSearchConfig
): Promise<BraveWebResult[]> {
  const url = new URL(config.brave.baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(options.count));

  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v === undefined) continue;
      if (!ALLOWED_PARAM_KEYS.has(k)) continue;
      const normalized = normalizeBraveParamValue(k, v);
      if (normalized === undefined) continue;
      url.searchParams.set(k, normalized);
    }
  }

  async function doFetch(urlStr: string): Promise<{ res: Response; keyIndex: number }> {
    const limit = getBraveGlobalLimiter(effectiveBraveConcurrency(config));

    // Important: concurrency needs to be global across the whole server process, not just
    // within a single `search` call, otherwise multiple concurrent tool invocations can
    // easily trigger Brave 429s even when per-call concurrency is low.
    return await limit(async () => {
      const pick = pickBraveKey(config.brave.apiKeys);
      if (pick.waitMs > 0) {
        // All keys appear to be cooling down. Wait for the soonest one.
        await sleep(pick.waitMs);
      }

      writeIoLog({
        type: 'http.request',
        service: 'brave',
        method: 'GET',
        url: urlStr,
        keyIndex: pick.index
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.brave.timeoutMs);
      try {
        const res = await fetch(urlStr, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': pick.key
          },
          signal: controller.signal
        });
        return { res, keyIndex: pick.index };
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.brave.retry.maxRetries; attempt += 1) {
    const { res, keyIndex } = await doFetch(url.toString());

    if (res.ok) {
      const st = getKeyState(keyIndex);
      st.consecutive429 = 0;
      const json = (await res.json()) as BraveSearchResponse;
      writeIoLog({
        type: 'http.response',
        service: 'brave',
        status: res.status,
        keyIndex,
        json
      });
      return json.web?.results?.filter(r => typeof r.url === 'string') ?? [];
    }

    const body = await res.text().catch(() => '');
    writeIoLog({
      type: 'http.response',
      service: 'brave',
      status: res.status,
      keyIndex,
      body
    });

    if (res.status === 422) {
      // Best-effort retry by dropping invalid query params (e.g. invalid country).
      const invalidKeys = extractInvalidQueryParamKeysFrom422(body);
      let removedAny = false;
      for (const key of invalidKeys) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          removedAny = true;
        }
      }
      if (removedAny) {
        lastError = new Error(`Brave Search API 422 (validation). Retrying after dropping invalid query params...`);
        continue;
      }
    }

    if (res.status === 429) {
      // Rate limited. Put the key on cooldown and retry with another key (or wait).
      const st = getKeyState(keyIndex);
      const retryAfterMs =
        config.brave.retry.respectRetryAfter ? parseRetryAfterMs(res.headers.get('retry-after')) : undefined;

      const exp = Math.min(st.consecutive429, 8);
      const fallbackDelay = config.brave.retry.initialBackoffMs * Math.pow(2, exp);
      const delayMs = Math.min(config.brave.retry.maxBackoffMs, retryAfterMs ?? fallbackDelay);

      st.consecutive429 += 1;
      st.cooldownUntilMs = Math.max(st.cooldownUntilMs, Date.now() + delayMs);

      lastError = new Error(
        `Brave Search API 429 (rate limited). Cooling down key for ${delayMs}ms (attempt ${attempt + 1}/${config.brave.retry.maxRetries + 1}).`
      );
      continue;
    }

    lastError = new Error(`Brave Search API error ${res.status}: ${body.slice(0, 300)}`);
    break;
  }

  throw lastError ?? new Error('Brave Search API error: failed after retries.');
}
