import { randomUUID } from "node:crypto";
import { TASK_VIEWERS_KEY_PREFIX } from "@meowbert/shared";
import { redis } from "../../lib/redis.js";

// A viewer counts while its entry is fresh; the stream refreshes it well before then, and an
// entry left by a crashed API process ages out on its own.
const VIEWER_TTL_MS = 90_000;
const REFRESH_MS = 30_000;

// Records that someone has a task open for as long as its live event stream stays connected.
// Smart cachebeat reads these entries to keep the prompt cache warm while the task is on screen.
export function trackTaskViewer(taskId: string): () => void {
  const key = `${TASK_VIEWERS_KEY_PREFIX}${taskId}`;
  const viewerId = randomUUID();
  // Presence only tunes how long a cache stays warm, so a Redis hiccup never disturbs the stream.
  const refresh = () => {
    const now = Date.now();
    redis.multi()
      .zadd(key, now + VIEWER_TTL_MS, viewerId)
      .zremrangebyscore(key, "-inf", now)
      .pexpire(key, VIEWER_TTL_MS)
      .exec()
      .catch(() => undefined);
  };
  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  timer.unref();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    void redis.zrem(key, viewerId).catch(() => undefined);
  };
}
