// A disposable per-process cache. Expiry is fixed from load, not extended by polling.
export function createTaskArchiveCache(input: {
  maxBytes?: number; maxEntries?: number; maxEntryBytes?: number; ttlMs?: number; now?: () => number;
} = {}) {
  const maxBytes = input.maxBytes ?? 128 * 1024 * 1024;
  const maxEntries = input.maxEntries ?? 2048;
  const maxEntryBytes = input.maxEntryBytes ?? 2_000_000;
  const ttlMs = input.ttlMs ?? 60 * 60 * 1000;
  const now = input.now ?? Date.now;
  const entries = new Map<string, { value: string; bytes: number; expiresAt: number }>();
  const pending = new Map<string, Promise<string>>();
  let bytes = 0;

  const remove = (key: string): void => {
    bytes -= entries.get(key)?.bytes ?? 0;
    entries.delete(key);
  };
  const retain = (key: string, value: string): string => {
    const size = Buffer.byteLength(value, "utf8");
    if (size > maxBytes || size > maxEntryBytes || maxEntries <= 0) return value;
    for (const [existing, entry] of entries) if (entry.expiresAt <= now()) remove(existing);
    remove(key);
    while (entries.size && (bytes + size > maxBytes || entries.size >= maxEntries)) {
      remove(entries.keys().next().value!);
    }
    entries.set(key, { value, bytes: size, expiresAt: now() + ttlMs });
    bytes += size;
    return value;
  };

  return {
    async read(key: string, load: () => Promise<string>): Promise<string> {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.value;
      }
      remove(key);
      const existing = pending.get(key);
      if (existing) return existing;
      // Bound bookkeeping too; requests above the limit read without being retained as pending.
      if (pending.size >= 64) return load();
      const request = load().then((value) => retain(key, value)).finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
    clear(): void { entries.clear(); bytes = 0; },
    size(): { bytes: number; entries: number } { return { bytes, entries: entries.size }; }
  };
}
