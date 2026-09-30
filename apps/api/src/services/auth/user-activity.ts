import { query } from "../../lib/db.js";

const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const lastSeenWriteCache = new Map<string, number>();

export async function recordAuthenticatedUserSeen(userId: string): Promise<void> {
  const nowMs = Date.now();
  const cachedLastWriteMs = lastSeenWriteCache.get(userId) ?? 0;
  if (nowMs - cachedLastWriteMs < LAST_SEEN_UPDATE_INTERVAL_MS) {
    return;
  }

  lastSeenWriteCache.set(userId, nowMs);

  await query(
    `UPDATE users
        SET last_seen_at = now()
      WHERE id = $1
        AND (
          last_seen_at IS NULL
          OR last_seen_at < now() - interval '5 minutes'
        )`,
    [userId]
  );
}
