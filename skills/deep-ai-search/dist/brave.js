import { writeIoLog } from './io-log.js';
import pLimit from 'p-limit';
const braveKeyStates = new Map();
let braveRoundRobinIndex = 0;
let braveGlobalLimiter = null;
let braveGlobalLimiterConcurrency = 0;
function getBraveGlobalLimiter(concurrency) {
    const c = Math.max(1, Math.floor(concurrency));
    if (!braveGlobalLimiter || braveGlobalLimiterConcurrency !== c) {
        braveGlobalLimiterConcurrency = c;
        braveGlobalLimiter = pLimit(c);
    }
    return braveGlobalLimiter;
}
function effectiveBraveConcurrency(config) {
    // If you only have 1 API key, higher concurrency just increases 429s.
    return Math.max(1, Math.min(config.brave.maxConcurrency, config.brave.apiKeys.length));
}
function getKeyState(index) {
    const existing = braveKeyStates.get(index);
    if (existing)
        return existing;
    const created = { cooldownUntilMs: 0, consecutive429: 0 };
    braveKeyStates.set(index, created);
    return created;
}
async function sleep(ms) {
    if (ms <= 0)
        return;
    await new Promise(resolve => setTimeout(resolve, ms));
}
function pickBraveKey(keys) {
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
            return { key: keys[idx], index: idx, waitMs: 0 };
        }
        if (st.cooldownUntilMs < bestUntil) {
            bestUntil = st.cooldownUntilMs;
            bestIndex = idx;
        }
    }
    braveRoundRobinIndex = bestIndex + 1;
    return { key: keys[bestIndex], index: bestIndex, waitMs: Math.max(0, bestUntil - now) };
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
function normalizeBraveParamValue(key, value) {
    // Brave expects certain query params to follow specific formats.
    // We normalize a few common ones here to reduce "422 VALIDATION" errors.
    if (key === 'country') {
        if (typeof value !== 'string')
            return undefined;
        const v = value.trim().toUpperCase();
        // Brave expects an ISO-3166 alpha-2 country code from an allowlist. We can't
        // hardcode the whole list, but we can at least enforce the common shape.
        if (!/^[A-Z]{2}$/.test(v))
            return undefined;
        return v;
    }
    if (key === 'search_lang' || key === 'ui_lang') {
        if (typeof value !== 'string')
            return undefined;
        const v = value.trim().toLowerCase();
        if (!v)
            return undefined;
        return v;
    }
    if (key === 'safesearch') {
        if (typeof value !== 'string')
            return String(value);
        return value.trim().toLowerCase();
    }
    return String(value);
}
function extractInvalidQueryParamKeysFrom422(bodyText) {
    try {
        const parsed = JSON.parse(bodyText);
        const errors = parsed?.error?.meta?.errors;
        if (!Array.isArray(errors))
            return [];
        const keys = [];
        for (const e of errors) {
            const loc = e?.loc;
            if (!Array.isArray(loc))
                continue;
            // Brave uses loc like ["query","country"].
            if (loc.length >= 2 && loc[0] === 'query' && typeof loc[1] === 'string') {
                keys.push(loc[1]);
            }
        }
        return keys;
    }
    catch {
        return [];
    }
}
function parseRetryAfterMs(value) {
    if (!value)
        return undefined;
    const v = value.trim();
    if (!v)
        return undefined;
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
export async function braveWebSearch(query, options, config) {
    const url = new URL(config.brave.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(options.count));
    if (options.params) {
        for (const [k, v] of Object.entries(options.params)) {
            if (v === undefined)
                continue;
            if (!ALLOWED_PARAM_KEYS.has(k))
                continue;
            const normalized = normalizeBraveParamValue(k, v);
            if (normalized === undefined)
                continue;
            url.searchParams.set(k, normalized);
        }
    }
    async function doFetch(urlStr) {
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
            }
            finally {
                clearTimeout(timeout);
            }
        });
    }
    let lastError = null;
    for (let attempt = 0; attempt <= config.brave.retry.maxRetries; attempt += 1) {
        const { res, keyIndex } = await doFetch(url.toString());
        if (res.ok) {
            const st = getKeyState(keyIndex);
            st.consecutive429 = 0;
            const json = (await res.json());
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
            const retryAfterMs = config.brave.retry.respectRetryAfter ? parseRetryAfterMs(res.headers.get('retry-after')) : undefined;
            const exp = Math.min(st.consecutive429, 8);
            const fallbackDelay = config.brave.retry.initialBackoffMs * Math.pow(2, exp);
            const delayMs = Math.min(config.brave.retry.maxBackoffMs, retryAfterMs ?? fallbackDelay);
            st.consecutive429 += 1;
            st.cooldownUntilMs = Math.max(st.cooldownUntilMs, Date.now() + delayMs);
            lastError = new Error(`Brave Search API 429 (rate limited). Cooling down key for ${delayMs}ms (attempt ${attempt + 1}/${config.brave.retry.maxRetries + 1}).`);
            continue;
        }
        lastError = new Error(`Brave Search API error ${res.status}: ${body.slice(0, 300)}`);
        break;
    }
    throw lastError ?? new Error('Brave Search API error: failed after retries.');
}
//# sourceMappingURL=brave.js.map