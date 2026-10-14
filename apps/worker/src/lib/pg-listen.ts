import type { PoolClient } from "pg";
import { pool } from "./db.js";

const LISTEN_RETRY_MS = 5_000;

// Holds one pooled connection on a PostgreSQL notification channel and reconnects after failures.
// onReconnect runs after every reconnect so callers can catch up on notifications they missed.
export function listenToPgChannel(input: {
  channel: string;
  onNotification: (payload: string | undefined) => void;
  onReconnect?: () => void;
}): { stop: () => Promise<void> } {
  let client: PoolClient | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let stopping = false;
  let connectedBefore = false;
  const released = new WeakSet<PoolClient>();

  // A broken connection is destroyed instead of going back to the pool.
  const release = (target: PoolClient, broken = false) => {
    if (released.has(target)) return;
    released.add(target);
    target.removeAllListeners("notification");
    target.removeAllListeners("error");
    if (client === target) client = null;
    target.release(broken);
  };

  const scheduleRetry = () => {
    if (stopping || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, LISTEN_RETRY_MS);
    retryTimer.unref();
  };

  const connect = async (): Promise<void> => {
    if (stopping || client) return;
    let next: PoolClient | null = null;
    try {
      next = await pool.connect();
      const connected = next;
      connected.on("notification", (message) => {
        if (message.channel === input.channel) input.onNotification(message.payload);
      });
      connected.on("error", (error) => {
        console.error(`[pg-listen] ${input.channel} listener failed`, error);
        release(connected, true);
        scheduleRetry();
      });
      await connected.query(`LISTEN ${input.channel}`);
      if (stopping) {
        release(connected);
        return;
      }
      client = connected;
      if (connectedBefore) input.onReconnect?.();
      connectedBefore = true;
    } catch (error) {
      console.error(`[pg-listen] Failed to listen on ${input.channel}`, error);
      if (next) release(next, true);
      scheduleRetry();
    }
  };

  void connect();

  return {
    stop: async () => {
      stopping = true;
      if (retryTimer) clearTimeout(retryTimer);
      const current = client;
      if (!current) return;
      await current.query(`UNLISTEN ${input.channel}`).catch(() => undefined);
      release(current);
    }
  };
}
