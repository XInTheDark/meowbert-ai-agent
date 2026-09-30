export interface CachedGetSnapshot<T> {
  data: T | null;
  promise: Promise<T>;
  fromCache: boolean;
}

export interface CachedGetOptions {
  ttlMs?: number;
  revalidate?: boolean;
}

export const API_CACHE_TTLS = {
  workspaceMetadata: 45_000,
  taskList: 8_000,
  taskDetail: 12_000,
  catalog: 5 * 60_000,
  short: 5_000
} as const;

interface CacheEntry {
  value: unknown;
  updatedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function now(): number {
  return Date.now();
}

function buildCacheKey(token: string | null, path: string): string {
  return `${token ?? "anonymous"} GET ${path}`;
}

function isFresh(entry: CacheEntry | undefined, ttlMs: number): boolean {
  return entry !== undefined && now() - entry.updatedAt <= ttlMs;
}

export function peekApiCache<T>(token: string | null, path: string): T | null {
  const entry = cache.get(buildCacheKey(token, path));
  return entry ? entry.value as T : null;
}

export function primeApiCache<T>(token: string | null, path: string, value: T): void {
  cache.set(buildCacheKey(token, path), {
    value,
    updatedAt: now()
  });
}

export function invalidateApiCache(input?: {
  token?: string | null;
  path?: string;
  pathPrefix?: string;
}): void {
  if (!input) {
    cache.clear();
    inFlight.clear();
    return;
  }

  const tokenPrefix = input.token === undefined ? "" : `${input.token ?? "anonymous"} GET `;
  if (!input.path && !input.pathPrefix) {
    if (input.token === undefined) {
      cache.clear();
      inFlight.clear();
      return;
    }

    for (const key of cache.keys()) {
      if (key.startsWith(tokenPrefix)) {
        cache.delete(key);
      }
    }
    for (const key of inFlight.keys()) {
      if (key.startsWith(tokenPrefix)) {
        inFlight.delete(key);
      }
    }
    return;
  }

  const exactKey = input.path && input.token !== undefined
    ? buildCacheKey(input.token, input.path)
    : null;

  for (const key of cache.keys()) {
    if (exactKey && key === exactKey) {
      cache.delete(key);
      continue;
    }

    if (input.path && input.token === undefined && key.endsWith(` GET ${input.path}`)) {
      cache.delete(key);
      continue;
    }

    if (input.pathPrefix) {
      const targetPrefix = `${tokenPrefix}${input.pathPrefix}`;
      if (input.token === undefined) {
        if (key.includes(` GET ${input.pathPrefix}`)) {
          cache.delete(key);
        }
      } else if (key.startsWith(targetPrefix)) {
        cache.delete(key);
      }
    }
  }

  for (const key of inFlight.keys()) {
    if (exactKey && key === exactKey) {
      inFlight.delete(key);
      continue;
    }

    if (input.path && input.token === undefined && key.endsWith(` GET ${input.path}`)) {
      inFlight.delete(key);
      continue;
    }

    if (input.pathPrefix) {
      const targetPrefix = `${tokenPrefix}${input.pathPrefix}`;
      if (input.token === undefined) {
        if (key.includes(` GET ${input.pathPrefix}`)) {
          inFlight.delete(key);
        }
      } else if (key.startsWith(targetPrefix)) {
        inFlight.delete(key);
      }
    }
  }
}

export function cachedApiGet<T>(
  token: string | null,
  path: string,
  fetcher: () => Promise<T>,
  options: CachedGetOptions = {}
): CachedGetSnapshot<T> {
  const ttlMs = options.ttlMs ?? API_CACHE_TTLS.short;
  const shouldRevalidate = options.revalidate !== false;
  const key = buildCacheKey(token, path);
  const entry = cache.get(key);

  if (entry && (!shouldRevalidate || isFresh(entry, ttlMs))) {
    return {
      data: entry.value as T,
      promise: Promise.resolve(entry.value as T),
      fromCache: true
    };
  }

  let request = inFlight.get(key) as Promise<T> | undefined;
  if (!request) {
    request = fetcher()
      .then((value) => {
        primeApiCache(token, path, value);
        return value;
      })
      .finally(() => {
        if (inFlight.get(key) === request) {
          inFlight.delete(key);
        }
      });
    inFlight.set(key, request);
  }

  return {
    data: entry ? entry.value as T : null,
    promise: request,
    fromCache: Boolean(entry)
  };
}

export function prefetchApiGet<T>(
  token: string | null,
  path: string,
  fetcher: () => Promise<T>,
  options: CachedGetOptions = {}
): Promise<T> {
  return cachedApiGet(token, path, fetcher, options).promise;
}

export function clearApiCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
