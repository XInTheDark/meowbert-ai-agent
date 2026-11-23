import { z } from "zod";

export const antigravityLoginStartInputSchema = z.object({
  label: z.string().trim().max(120).optional()
});

export const antigravityLoginCompleteInputSchema = z.object({
  loginSessionId: z.string().trim().min(1).max(128),
  codeOrCallbackUrl: z.string().trim().min(1).max(4096)
});

export const antigravityLoginCancelInputSchema = z.object({
  loginSessionId: z.string().trim().min(1).max(128)
});

export interface AdminAntigravityCredential {
  id: string;
  label: string;
  email: string | null;
  tierName: string | null;
  tierId: string | null;
  selected: boolean;
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AntigravityLoginStartResult {
  loginSessionId: string;
  authUrl: string;
  expiresAt: string;
}

export interface AntigravityConfigOptionChoice {
  value: string;
  label: string;
  description?: string | null;
}

export interface AntigravityCredentialModelsResult {
  models: AntigravityConfigOptionChoice[];
  thinkingLevels: AntigravityConfigOptionChoice[];
  tierName: string | null;
  tierId: string | null;
}

export interface AntigravityUsageGroup {
  name: string;
  raw: Record<string, unknown>;
}

export interface AntigravityCredentialUsageResult {
  groups: AntigravityUsageGroup[];
  raw: Record<string, unknown>;
}
