import type { RuntimeResourceDraft } from "./runtime-resource-draft";

export interface UserSubscriptionSummary {
  id: string;
  name: string;
  monthlyTokenQuota: number;
  usageLimits?: Array<{ weightedTokens: number; durationDays: number }>;
  isActive: boolean;
}

export interface UserResourceLimits {
  workspaceLimit: number | null;
  sandboxPidsLimit: number | null;
  sandboxMemoryMb: number | null;
  sandboxCpus: number | null;
  workspaceStorageMb: number | null;
  persistentRuntimeComputeCredits: number | null;
  persistentRuntimeLimit: number | null;
  effectiveWorkspaceLimit: number;
  effectiveSandboxPidsLimit: number;
  effectiveSandboxMemoryMb: number | null;
  effectiveSandboxCpus: number | null;
  effectiveWorkspaceStorageMb: number | null;
  effectivePersistentRuntimeComputeCredits: number;
  effectivePersistentRuntimeLimit: number;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  resourceLimits: UserResourceLimits;
  isSuperAdmin: boolean;
  isActive: boolean;
  signupApprovalStatus: "approved" | "pending" | "rejected";
  freeMessageLimit: number | null;
  freeMessagesUsed: number;
  monthlyWeightedTokensUsed: number;
  monthlyWeightedTokensLimit: number;
  subscriptions: UserSubscriptionSummary[];
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthlyTokenQuota: number;
  usageLimits?: Array<{ weightedTokens: number; durationDays: number }>;
  notes: string | null;
  isActive: boolean;
  isDefault?: boolean;
}

export interface UsersResponse {
  users: AdminUser[];
  total: number;
}

export interface SubscriptionPlansResponse {
  plans: SubscriptionPlan[];
}

export type ResourceDraft = RuntimeResourceDraft;
