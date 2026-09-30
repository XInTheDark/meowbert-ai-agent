import { isSuperAdmin } from "../admin/admin-settings.js";
import { getUserFreeMessageUsage, resolveUserFreeMessageLimit } from "../billing/subscriptions.js";

export interface RateLimitStatus {
  used: number;
  limit: number;
  exceeded: boolean;
  windowHours: number;
}

export async function checkUserMessageRateLimit(userId: string): Promise<RateLimitStatus> {
  // Super admins are exempt
  if (await isSuperAdmin(userId)) {
    return { used: 0, limit: Infinity, exceeded: false, windowHours: 24 };
  }

  const [effectiveLimit, used] = await Promise.all([
    resolveUserFreeMessageLimit(userId),
    getUserFreeMessageUsage(userId)
  ]);

  return {
    used,
    limit: effectiveLimit ?? Infinity,
    exceeded: effectiveLimit !== null && used >= effectiveLimit,
    windowHours: 0
  };
}
