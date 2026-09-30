import { DEFAULT_MEMORY_ENABLED } from "@meowbert/shared";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../../lib/db.js";
import { normalizeConnectorAgentId } from "../connector-agent.js";
import { normalizeConnectorToolOptionsConfig, type ConnectorToolOptionsConfig } from "../connector-tools.js";
import {
  normalizeEmailAddress,
  normalizeEmailLocalPart,
  normalizeInboundDomain,
  parseTrustedSenderArray,
  splitNormalizedEmailAddress
} from "./address-utils.js";

export type EmailSenderPolicy = "allow_any" | "trusted_only";

interface WorkspaceEmailConnectorRow {
  workspace_id: string;
  binding_id: string;
  binding_status: string;
  local_part: string;
  sender_policy: EmailSenderPolicy;
  trusted_senders: string[];
  default_environment_id: string | null;
  agent_id: string | null;
  tool_options: Record<string, unknown> | null;
  memory_enabled: boolean;
  prefix_enabled: boolean;
  keyword_enabled: boolean;
  llm_fallback_enabled: boolean;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceEmailConnector {
  workspaceId: string;
  bindingId: string;
  status: string;
  localPart: string;
  senderPolicy: EmailSenderPolicy;
  trustedSenders: string[];
  defaultEnvironmentId: string | null;
  agentId: string | null;
  tools: ConnectorToolOptionsConfig;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const AUTO_LOCAL_PART_SENTINEL = "__auto__";

function mapRow(row: WorkspaceEmailConnectorRow): WorkspaceEmailConnector {
  return {
    workspaceId: row.workspace_id,
    bindingId: row.binding_id,
    status: row.binding_status,
    localPart: row.local_part,
    senderPolicy: row.sender_policy === "trusted_only" ? "trusted_only" : "allow_any",
    trustedSenders: parseTrustedSenderArray(row.trusted_senders),
    defaultEnvironmentId: row.default_environment_id,
    agentId: normalizeConnectorAgentId(row.agent_id),
    tools: normalizeConnectorToolOptionsConfig(row.tool_options, row.memory_enabled),
    prefixEnabled: row.prefix_enabled !== false,
    keywordEnabled: row.keyword_enabled !== false,
    llmFallbackEnabled: row.llm_fallback_enabled !== false,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildConfigJson(input: {
  localPart: string;
  senderPolicy: EmailSenderPolicy;
  trustedSenders: string[];
  defaultEnvironmentId: string | null;
  agentId: string | null;
  tools: ConnectorToolOptionsConfig;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
}): Record<string, unknown> {
  return {
    connectionMode: "custom",
    mode: "inbound",
    localPart: input.localPart,
    senderPolicy: input.senderPolicy,
    trustedSenders: input.trustedSenders,
    defaultEnvironmentId: input.defaultEnvironmentId,
    agentId: normalizeConnectorAgentId(input.agentId),
    tools: input.tools,
    prefixEnabled: input.prefixEnabled,
    keywordEnabled: input.keywordEnabled,
    llmFallbackEnabled: input.llmFallbackEnabled
  };
}

function normalizeSenderPolicy(value: string | null | undefined): EmailSenderPolicy {
  return value === "trusted_only" ? "trusted_only" : "allow_any";
}

function normalizeTrustedSenders(values: string[] | null | undefined): string[] {
  return parseTrustedSenderArray(values);
}

function generateRandomLocalPart(): string {
  return `ws-${randomBytes(6).toString("hex")}`;
}

async function createUniqueRandomLocalPart(client: PoolClient): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const localPart = generateRandomLocalPart();
    const existing = await client.query(
      `SELECT 1
         FROM workspace_email_connectors
        WHERE lower(local_part) = $1
        LIMIT 1`,
      [localPart]
    );
    if ((existing.rowCount ?? 0) === 0) {
      return localPart;
    }
  }

  throw new Error("Failed to allocate a unique email local-part. Please try again.");
}

export function buildWorkspaceEmailAddress(localPart: string, inboundDomain: string | null): string | null {
  const normalizedLocalPart = normalizeEmailLocalPart(localPart);
  const normalizedDomain = normalizeInboundDomain(inboundDomain);
  if (!normalizedLocalPart || !normalizedDomain) {
    return null;
  }

  return `${normalizedLocalPart}@${normalizedDomain}`;
}

export function sanitizeLocalPartFromUserInput(value: string | null | undefined): string | null {
  return normalizeEmailLocalPart(value);
}

export async function getWorkspaceEmailConnector(workspaceId: string): Promise<WorkspaceEmailConnector | null> {
  const result = await query<WorkspaceEmailConnectorRow>(
    `SELECT wec.workspace_id,
            wec.binding_id,
            cb.status AS binding_status,
            wec.local_part,
            wec.sender_policy,
            wec.trusted_senders,
            wec.default_environment_id,
            cb.config_json->>'agentId' AS agent_id,
            cb.config_json->'tools' AS tool_options,
            COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled,
            wec.prefix_enabled,
            wec.keyword_enabled,
            wec.llm_fallback_enabled,
            wec.updated_by_user_id,
            wec.created_at::text,
            wec.updated_at::text
       FROM workspace_email_connectors wec
       JOIN connector_bindings cb
         ON cb.id = wec.binding_id
       LEFT JOIN workspace_settings ws
         ON ws.workspace_id = wec.workspace_id
      WHERE wec.workspace_id = $1
        AND cb.type = 'email'
      LIMIT 1`,
    [workspaceId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  return mapRow(result.rows[0]);
}

export async function upsertWorkspaceEmailConnector(input: {
  workspaceId: string;
  localPart: string | null;
  senderPolicy: EmailSenderPolicy;
  trustedSenders: string[];
  defaultEnvironmentId: string | null;
  agentId: string | null;
  tools: ConnectorToolOptionsConfig;
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
  updatedByUserId: string;
}): Promise<WorkspaceEmailConnector> {
  const requestedAutoLocalPart = input.localPart === AUTO_LOCAL_PART_SENTINEL;
  const normalizedLocalPart = requestedAutoLocalPart
    ? AUTO_LOCAL_PART_SENTINEL
    : normalizeEmailLocalPart(input.localPart);
  if (!normalizedLocalPart) {
    throw new Error("Email local-part is invalid. Use lowercase letters, digits, '.', '-', '_', or '+'.");
  }

  const normalizedSenderPolicy = normalizeSenderPolicy(input.senderPolicy);
  const normalizedTrustedSenders = normalizeTrustedSenders(input.trustedSenders);

  return withTransaction(async (client) => {
    const existing = await client.query<{ local_part: string }>(
      `SELECT local_part
         FROM workspace_email_connectors
        WHERE workspace_id = $1
        LIMIT 1`,
      [input.workspaceId]
    );

    const finalLocalPart =
      requestedAutoLocalPart
        ? (existing.rows[0]?.local_part ?? (await createUniqueRandomLocalPart(client)))
        : normalizedLocalPart;

    const configJson = buildConfigJson({
      localPart: finalLocalPart,
      senderPolicy: normalizedSenderPolicy,
      trustedSenders: normalizedTrustedSenders,
      defaultEnvironmentId: input.defaultEnvironmentId,
      agentId: input.agentId,
      tools: input.tools,
      prefixEnabled: input.prefixEnabled,
      keywordEnabled: input.keywordEnabled,
      llmFallbackEnabled: input.llmFallbackEnabled
    });

    const bindingResult = await client.query<{ id: string }>(
      `INSERT INTO connector_bindings (workspace_id, type, status, config_json)
       VALUES ($1, 'email', 'active', $2::jsonb)
       ON CONFLICT (workspace_id, type)
       DO UPDATE SET
         status = 'active',
         config_json = EXCLUDED.config_json,
         updated_at = now()
       RETURNING id`,
      [input.workspaceId, JSON.stringify(configJson)]
    );

    const bindingId = bindingResult.rows[0].id;

    const result = await client.query<WorkspaceEmailConnectorRow>(
      `INSERT INTO workspace_email_connectors (
         workspace_id,
         binding_id,
         local_part,
         sender_policy,
         trusted_senders,
         default_environment_id,
         prefix_enabled,
         keyword_enabled,
         llm_fallback_enabled,
         updated_by_user_id,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, now())
       ON CONFLICT (workspace_id)
       DO UPDATE SET
         binding_id = EXCLUDED.binding_id,
         local_part = EXCLUDED.local_part,
         sender_policy = EXCLUDED.sender_policy,
         trusted_senders = EXCLUDED.trusted_senders,
         default_environment_id = EXCLUDED.default_environment_id,
         prefix_enabled = EXCLUDED.prefix_enabled,
         keyword_enabled = EXCLUDED.keyword_enabled,
         llm_fallback_enabled = EXCLUDED.llm_fallback_enabled,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = now()
       RETURNING workspace_id,
                 binding_id,
                 'active'::text AS binding_status,
                 local_part,
                 sender_policy,
                 trusted_senders,
                 default_environment_id,
                 $11::text AS agent_id,
                 $12::jsonb AS tool_options,
                 COALESCE((SELECT memory_enabled FROM workspace_settings WHERE workspace_id = $1), ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled,
                 prefix_enabled,
                 keyword_enabled,
                 llm_fallback_enabled,
                 updated_by_user_id,
                 created_at::text,
                 updated_at::text`,
      [
        input.workspaceId,
        bindingId,
        finalLocalPart,
        normalizedSenderPolicy,
        normalizedTrustedSenders,
        input.defaultEnvironmentId,
        input.prefixEnabled,
        input.keywordEnabled,
        input.llmFallbackEnabled,
        input.updatedByUserId,
        normalizeConnectorAgentId(input.agentId),
        JSON.stringify(input.tools)
      ]
    );

    return mapRow(result.rows[0]);
  });
}

export async function disableWorkspaceEmailConnector(workspaceId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM workspace_email_connectors
        WHERE workspace_id = $1`,
      [workspaceId]
    );

    await client.query(
      `DELETE FROM connector_bindings
        WHERE workspace_id = $1
          AND type = 'email'`,
      [workspaceId]
    );
  });
}

export async function findWorkspaceEmailConnectorByRecipient(input: {
  recipientEmail: string;
  inboundDomain: string;
}): Promise<WorkspaceEmailConnector | null> {
  const normalizedRecipient = normalizeEmailAddress(input.recipientEmail);
  const normalizedInboundDomain = normalizeInboundDomain(input.inboundDomain);
  if (!normalizedRecipient || !normalizedInboundDomain) {
    return null;
  }

  const recipientParts = splitNormalizedEmailAddress(normalizedRecipient);
  if (!recipientParts || recipientParts.domain !== normalizedInboundDomain) {
    return null;
  }

  const result = await query<WorkspaceEmailConnectorRow>(
    `SELECT wec.workspace_id,
            wec.binding_id,
            cb.status AS binding_status,
            wec.local_part,
            wec.sender_policy,
            wec.trusted_senders,
            wec.default_environment_id,
            cb.config_json->>'agentId' AS agent_id,
            cb.config_json->'tools' AS tool_options,
            COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS memory_enabled,
            wec.prefix_enabled,
            wec.keyword_enabled,
            wec.llm_fallback_enabled,
            wec.updated_by_user_id,
            wec.created_at::text,
            wec.updated_at::text
       FROM workspace_email_connectors wec
       JOIN connector_bindings cb
         ON cb.id = wec.binding_id
       LEFT JOIN workspace_settings ws
         ON ws.workspace_id = wec.workspace_id
      WHERE lower(wec.local_part) = $1
        AND cb.type = 'email'
        AND cb.status = 'active'
      LIMIT 1`,
    [recipientParts.localPart]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  return mapRow(result.rows[0]);
}

export function shouldAllowEmailSender(input: {
  senderPolicy: EmailSenderPolicy;
  trustedSenders: string[];
  senderEmail: string;
}): boolean {
  if (input.senderPolicy === "allow_any") {
    return true;
  }

  const sender = normalizeEmailAddress(input.senderEmail);
  if (!sender) {
    return false;
  }

  const trusted = new Set(parseTrustedSenderArray(input.trustedSenders));
  return trusted.has(sender);
}
