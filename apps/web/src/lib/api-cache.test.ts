import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  API_CACHE_TTLS,
  cachedApiGet,
  clearApiCacheForTests,
  invalidateApiCache,
  peekApiCache,
  prefetchApiGet
} from "./api-cache";

describe("api-cache", () => {
  beforeEach(() => {
    clearApiCacheForTests();
    vi.useRealTimers();
  });

  it("returns cached data immediately while revalidating stale entries", async () => {
    const fetcher = vi
      .fn<() => Promise<{ value: string }>>()
      .mockResolvedValueOnce({ value: "first" })
      .mockResolvedValueOnce({ value: "second" });

    await cachedApiGet("token-a", "/api/example", fetcher, { ttlMs: 5 }).promise;

    await new Promise((resolve) => setTimeout(resolve, 25));
    const snapshot = cachedApiGet("token-a", "/api/example", fetcher, { ttlMs: 5 });

    expect(snapshot.fromCache).toBe(true);
    expect(snapshot.data).toEqual({ value: "first" });
    await expect(snapshot.promise).resolves.toEqual({ value: "second" });
    expect(peekApiCache("token-a", "/api/example")).toEqual({ value: "second" });
  });

  it("dedupes in-flight requests", async () => {
    let resolveRequest: (value: { value: string }) => void = () => {};
    const fetcher = vi.fn(
      () => new Promise<{ value: string }>((resolve) => {
        resolveRequest = resolve;
      })
    );

    const first = cachedApiGet("token-a", "/api/example", fetcher, { ttlMs: API_CACHE_TTLS.short });
    const second = prefetchApiGet("token-a", "/api/example", fetcher, { ttlMs: API_CACHE_TTLS.short });

    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveRequest({ value: "done" });
    await expect(first.promise).resolves.toEqual({ value: "done" });
    await expect(second).resolves.toEqual({ value: "done" });
  });

  it("isolates cache entries by token", async () => {
    await cachedApiGet("token-a", "/api/example", async () => ({ value: "a" })).promise;
    await cachedApiGet("token-b", "/api/example", async () => ({ value: "b" })).promise;

    expect(peekApiCache("token-a", "/api/example")).toEqual({ value: "a" });
    expect(peekApiCache("token-b", "/api/example")).toEqual({ value: "b" });
  });

  it("invalidates by path prefix within a token", async () => {
    await cachedApiGet("token-a", "/api/projects/one/tasks", async () => ({ value: "a" })).promise;
    await cachedApiGet("token-b", "/api/projects/one/tasks", async () => ({ value: "b" })).promise;

    invalidateApiCache({ token: "token-a", pathPrefix: "/api/projects/one" });

    expect(peekApiCache("token-a", "/api/projects/one/tasks")).toBeNull();
    expect(peekApiCache("token-b", "/api/projects/one/tasks")).toEqual({ value: "b" });
  });
});
