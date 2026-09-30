import { z } from "zod";
import type { ConnectorType } from "@meowbert/shared";
import { config } from "../../lib/config.js";

export const workspaceParams = z.object({ wsId: z.string().uuid() });

export const connectorToolOptionsSchema = z.object({
  webSearch: z.boolean().optional(),
  memorySearch: z.boolean().optional(),
  scheduleTask: z.boolean().optional(),
  subtasks: z.boolean().optional(),
  enabledSkills: z.array(z.string()).optional(),
  enabledSources: z.array(z.string()).optional()
});

export interface ConnectorBindingRow {
  id: string;
  type: ConnectorType;
  status: string;
  config_json: Record<string, unknown>;
  paired_at?: string | null;
  email_local_part?: string | null;
  email_sender_policy?: "allow_any" | "trusted_only" | null;
  email_trusted_senders?: string[] | null;
  email_default_environment_id?: string | null;
  email_prefix_enabled?: boolean | null;
  email_keyword_enabled?: boolean | null;
  email_llm_fallback_enabled?: boolean | null;
}

export interface WorkspaceMemberRoleRow {
  role: string;
}

export interface WorkspaceGitHubRoleRow {
  role: string;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function buildTelegramWebhookUrl(bindingId: string): string {
  const trimmedPublicUrl = config.server.publicUrl.replace(/\/+$/, "");
  return `${trimmedPublicUrl}/api/connectors/telegram/${bindingId}/webhook`;
}

export function connectorsUiUrlForWorkspace(returnOrigin: string, workspaceId: string, githubInstallStatus?: string): string {
  const target = new URL(`/app/${workspaceId}/connectors`, returnOrigin);
  if (githubInstallStatus) {
    target.searchParams.set("github_install", githubInstallStatus);
  }
  return target.toString();
}
