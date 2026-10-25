import { Pool } from "pg";
import { RunApiFailure } from "./failure.js";

export const MODEL_REQUESTS_PER_USER = 4;
// Keep admission connections separate: model billing and completion still need the main pool.
export function createUserModelRequestSlots(connectionString: string) {
  const slots = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
  slots.on("error", (error) => console.error("[run-api] Model admission connection failed", error));

  async function withSlot<T>(userId: string, signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const client = await slots.connect();
    let key: string | null = null;
    let broken = false;
    const disconnected = new AbortController();
    const onError = () => { broken = true; disconnected.abort(); };
    client.on("error", onError);
    try {
      for (let index = 0; index < MODEL_REQUESTS_PER_USER; index += 1) {
        const candidate = "run-api:model:" + userId + ":" + index;
        const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [candidate]);
        if (result.rows[0]?.acquired) { key = candidate; break; }
      }
      if (!key) throw new RunApiFailure("rate_limited", "Too many model requests for this user. Retry shortly.");
      signal.throwIfAborted();
      return await run(AbortSignal.any([signal, disconnected.signal]));
    } finally {
      if (key && !broken) {
        try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]); }
        catch { broken = true; }
      }
      client.off("error", onError);
      client.release(broken);
    }
  }

  return { withSlot, close: () => slots.end() };
}
