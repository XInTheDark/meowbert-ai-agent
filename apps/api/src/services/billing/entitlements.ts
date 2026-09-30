import { isSuperAdmin } from "../admin/admin-settings.js";
import {
  getUserByoConfig,
  getUserFreeMessageUsage,
  getUserMonthlyWeightedTokenUsage,
  getUserSubscriptionUsageLimits,
  recordUserFreeMessageEvent,
  resolveUserFreeMessageLimit
} from "./subscriptions.js";

export type UserAccessMode = "admin_exempt" | "byo" | "subscription" | "free";

export interface PromptEntitlementStatus {
  mode: UserAccessMode;
  allowed: boolean;
  reason: string | null;
  freeMessageLimit: number | null;
  freeMessagesUsed: number;
  monthlyWeightedTokenLimit: number;
  monthlyWeightedTokenUsed: number;
  subscriptionUsageLimitExceeded: boolean;
}

export async function getPromptEntitlementStatus(userId: string): Promise<PromptEntitlementStatus> {
  if (await isSuperAdmin(userId)) {
    return {
      mode: "admin_exempt",
      allowed: true,
      reason: null,
      freeMessageLimit: 0,
      freeMessagesUsed: 0,
      monthlyWeightedTokenLimit: 0,
      monthlyWeightedTokenUsed: 0,
      subscriptionUsageLimitExceeded: false
    };
  }

  const [byoConfig, freeLimit, freeUsed, monthlyUsage, usageLimits] = await Promise.all([
    getUserByoConfig(userId),
    resolveUserFreeMessageLimit(userId),
    getUserFreeMessageUsage(userId),
    getUserMonthlyWeightedTokenUsage(userId),
    getUserSubscriptionUsageLimits(userId)
  ]);
  const hasSubscriptionLimit = usageLimits.limits.length > 0 || monthlyUsage.weightedTokensLimit > 0;
  const exceededLimit = usageLimits.limits.some((limit) => limit.exceeded)
    || (usageLimits.limits.length === 0 && monthlyUsage.weightedTokensLimit > 0
      ? monthlyUsage.weightedTokensUsed >= monthlyUsage.weightedTokensLimit
      : false);

  if (byoConfig.enabled) {
    return {
      mode: "byo",
      allowed: true,
      reason: null,
      freeMessageLimit: freeLimit,
      freeMessagesUsed: freeUsed,
      monthlyWeightedTokenLimit: monthlyUsage.weightedTokensLimit,
      monthlyWeightedTokenUsed: monthlyUsage.weightedTokensUsed,
      subscriptionUsageLimitExceeded: exceededLimit
    };
  }

  if (hasSubscriptionLimit) {
    const allowed = !exceededLimit;
    return {
      mode: "subscription",
      allowed,
      reason: allowed ? null : "Subscription usage limit reached.",
      freeMessageLimit: freeLimit,
      freeMessagesUsed: freeUsed,
      monthlyWeightedTokenLimit: monthlyUsage.weightedTokensLimit,
      monthlyWeightedTokenUsed: monthlyUsage.weightedTokensUsed,
      subscriptionUsageLimitExceeded: exceededLimit
    };
  }

  const allowed = freeLimit === null || freeUsed < freeLimit;
  return {
    mode: "free",
    allowed,
    reason: allowed ? null : "Lifetime free message quota exceeded.",
    freeMessageLimit: freeLimit,
    freeMessagesUsed: freeUsed,
    monthlyWeightedTokenLimit: monthlyUsage.weightedTokensLimit,
    monthlyWeightedTokenUsed: monthlyUsage.weightedTokensUsed,
    subscriptionUsageLimitExceeded: exceededLimit
  };
}

export async function recordPromptUsageIfRequired(input: {
  userId: string;
  mode: UserAccessMode;
  taskId: string;
  taskMessageId: string;
}): Promise<void> {
  if (input.mode !== "free") {
    return;
  }

  await recordUserFreeMessageEvent({
    userId: input.userId,
    taskId: input.taskId,
    taskMessageId: input.taskMessageId
  });
}
