import { describe, expect, it, vi } from "vitest";
import { createTaskArchiveCache } from "./task-history-archive-cache.js";

describe("archive read cache", () => {
  it("expires one hour after loading even when frequently read", async () => {
    let now = 0;
    const cache = createTaskArchiveCache({ now: () => now });
    const load = vi.fn(async () => "payload");
    await cache.read("a", load);
    now = 3_599_999;
    await cache.read("a", load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 3_600_000;
    await cache.read("a", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("evicts the least recently used payload under its byte cap", async () => {
    const cache = createTaskArchiveCache({ maxBytes: 6 });
    const a = vi.fn(async () => "aaa");
    const b = vi.fn(async () => "bbb");
    await cache.read("a", a); await cache.read("b", b); await cache.read("a", a);
    await cache.read("c", async () => "ccc");
    expect(cache.size()).toEqual({ bytes: 6, entries: 2 });
    await cache.read("a", a); expect(a).toHaveBeenCalledTimes(1);
    await cache.read("b", b); expect(b).toHaveBeenCalledTimes(2);
    await cache.read("oversize", async () => "1234567");
    expect(cache.size().bytes).toBeLessThanOrEqual(6);
  });
  it("shares concurrent loads and retries failures", async () => {
    const cache = createTaskArchiveCache();
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = cache.read("a", load); const second = cache.read("a", load);
    resolve("payload"); expect(await Promise.all([first, second])).toEqual(["payload", "payload"]);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(cache.read("bad", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await cache.read("bad", async () => "recovered")).toBe("recovered");
  });
  it("bounds bookkeeping for tiny payloads", async () => {
    const cache = createTaskArchiveCache({ maxEntries: 2 });
    for (let i = 0; i < 10; i++) await cache.read(String(i), async () => "");
    expect(cache.size().entries).toBe(2);
  });
  it("does not retain a single oversized chunk even below the total byte cap", async () => {
    const cache = createTaskArchiveCache({ maxBytes: 100, maxEntryBytes: 5 });
    const load = vi.fn(async () => "123456");
    await cache.read("large", load);
    await cache.read("large", load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size()).toEqual({ bytes: 0, entries: 0 });
  });
});
