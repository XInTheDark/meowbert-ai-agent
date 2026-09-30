import type { ConnectorType } from "@meowbert/shared";
import { query } from "../../lib/db.js";

interface ExternalIdentityRow {
  user_id: string;
  is_super_admin: boolean;
}

interface SharedBindingRow {
  binding_id: string;
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  has_pairing: boolean;
  has_grant: boolean;
}

interface ConnectorChatContextRow {
  id: string;
  connector_type: ConnectorType;
  external_chat_id: string;
  external_thread_id: string;
  binding_id: string;
  workspace_id: string;
  discord_access_mode: "restricted" | "open";
}

interface WorkspaceBindingBySlugRow {
  binding_id: string;
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
}

export interface ExternalConnectorIdentity {
  userId: string;
  isSuperAdmin: boolean;
}

export interface SharedWorkspaceCandidate {
  bindingId: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  hasPairing: boolean;
  hasGrant: boolean;
}

export interface ConnectorChatContext {
  id: string;
  connectorType: ConnectorType;
  externalChatId: string;
  externalThreadId: string;
  bindingId: string;
  workspaceId: string;
  discordAccessMode: "restricted" | "open";
}

function mapWorkspaceCandidate(row: SharedBindingRow): SharedWorkspaceCandidate {
  return {
    bindingId: row.binding_id,
    workspaceId: row.workspace_id,
    workspaceSlug: row.workspace_slug,
    workspaceName: row.workspace_name,
    hasPairing: row.has_pairing,
    hasGrant: row.has_grant
  };
}

function mapChatContext(row: ConnectorChatContextRow): ConnectorChatContext {
  return {
    id: row.id,
    connectorType: row.connector_type,
    externalChatId: row.external_chat_id,
    externalThreadId: row.external_thread_id,
    bindingId: row.binding_id,
    workspaceId: row.workspace_id,
    discordAccessMode: row.discord_access_mode
  };
}

export async function resolveExternalConnectorIdentity(
  connectorType: ConnectorType,
  externalUserId: string
): Promise<ExternalConnectorIdentity | null> {
  const result = await query<ExternalIdentityRow>(
    `SELECT DISTINCT cp.user_id,
            u.is_super_admin
       FROM connector_pairings cp
       JOIN connector_bindings cb ON cb.id = cp.binding_id
       JOIN users u ON u.id = cp.user_id
      WHERE cb.type = $1
        AND cb.status = 'active'
        AND COALESCE(cb.config_json->>'connectionMode', 'custom') = 'shared'
        AND cp.external_user_id = $2`,
    [connectorType, externalUserId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  const distinctUserIds = new Set(result.rows.map((row) => row.user_id));
  if (distinctUserIds.size > 1) {
    throw new Error(`External ${connectorType} account is paired with multiple internal users`);
  }

  const row = result.rows[0];
  return {
    userId: row.user_id,
    isSuperAdmin: row.is_super_admin
  };
}

async function listSharedWorkspaceCandidatesForSuperAdmin(input: {
  connectorType: ConnectorType;
  externalUserId: string;
}): Promise<SharedWorkspaceCandidate[]> {
  const result = await query<SharedBindingRow>(
    `SELECT cb.id AS binding_id,
            cb.workspace_id,
            w.slug AS workspace_slug,
            w.name AS workspace_name,
            EXISTS(
              SELECT 1
                FROM connector_pairings cp
               WHERE cp.binding_id = cb.id
                 AND cp.external_user_id = $2
            ) AS has_pairing,
            EXISTS(
              SELECT 1
                FROM connector_external_grants ceg
               WHERE ceg.binding_id = cb.id
                 AND ceg.external_user_id = $2
            ) AS has_grant
       FROM connector_bindings cb
       JOIN workspaces w ON w.id = cb.workspace_id
      WHERE cb.type = $1
        AND cb.status = 'active'
        AND COALESCE(cb.config_json->>'connectionMode', 'custom') = 'shared'
      ORDER BY w.slug ASC`,
    [input.connectorType, input.externalUserId]
  );

  return result.rows.map(mapWorkspaceCandidate);
}

async function listSharedWorkspaceCandidatesForAuthorizedUser(input: {
  connectorType: ConnectorType;
  externalUserId: string;
}): Promise<SharedWorkspaceCandidate[]> {
  const result = await query<SharedBindingRow>(
    `SELECT DISTINCT cb.id AS binding_id,
            cb.workspace_id,
            w.slug AS workspace_slug,
            w.name AS workspace_name,
            EXISTS(
              SELECT 1
                FROM connector_pairings cp2
                JOIN workspace_members wm2
                  ON wm2.workspace_id = cb.workspace_id
                 AND wm2.user_id = cp2.user_id
               WHERE cp2.binding_id = cb.id
                 AND cp2.external_user_id = $2
            ) AS has_pairing,
            EXISTS(
              SELECT 1
                FROM connector_external_grants ceg2
               WHERE ceg2.binding_id = cb.id
                 AND ceg2.external_user_id = $2
            ) AS has_grant
       FROM connector_bindings cb
       JOIN workspaces w ON w.id = cb.workspace_id
      WHERE cb.type = $1
        AND cb.status = 'active'
        AND COALESCE(cb.config_json->>'connectionMode', 'custom') = 'shared'
        AND (
          EXISTS(
            SELECT 1
              FROM connector_pairings cp
              JOIN workspace_members wm
                ON wm.workspace_id = cb.workspace_id
               AND wm.user_id = cp.user_id
             WHERE cp.binding_id = cb.id
               AND cp.external_user_id = $2
          )
          OR EXISTS(
            SELECT 1
              FROM connector_external_grants ceg
             WHERE ceg.binding_id = cb.id
               AND ceg.external_user_id = $2
          )
        )
      ORDER BY w.slug ASC`,
    [input.connectorType, input.externalUserId]
  );

  return result.rows.map(mapWorkspaceCandidate);
}

export async function listSharedWorkspaceCandidates(input: {
  connectorType: ConnectorType;
  externalUserId: string;
}): Promise<{ identity: ExternalConnectorIdentity | null; candidates: SharedWorkspaceCandidate[] }> {
  const identity = await resolveExternalConnectorIdentity(input.connectorType, input.externalUserId);
  const candidates = identity?.isSuperAdmin
    ? await listSharedWorkspaceCandidatesForSuperAdmin(input)
    : await listSharedWorkspaceCandidatesForAuthorizedUser(input);

  return {
    identity,
    candidates
  };
}

export async function findSharedWorkspaceBindingBySlug(input: {
  connectorType: ConnectorType;
  workspaceSlug: string;
}): Promise<SharedWorkspaceCandidate | null> {
  const result = await query<WorkspaceBindingBySlugRow>(
    `SELECT cb.id AS binding_id,
            cb.workspace_id,
            w.slug AS workspace_slug,
            w.name AS workspace_name
       FROM connector_bindings cb
       JOIN workspaces w ON w.id = cb.workspace_id
      WHERE cb.type = $1
        AND cb.status = 'active'
        AND COALESCE(cb.config_json->>'connectionMode', 'custom') = 'shared'
        AND lower(w.slug) = lower($2)
      LIMIT 1`,
    [input.connectorType, input.workspaceSlug]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    bindingId: row.binding_id,
    workspaceId: row.workspace_id,
    workspaceSlug: row.workspace_slug,
    workspaceName: row.workspace_name,
    hasPairing: false,
    hasGrant: false
  };
}

export async function getConnectorChatContext(input: {
  connectorType: ConnectorType;
  externalChatId: string;
  externalThreadId: string;
}): Promise<ConnectorChatContext | null> {
  const result = await query<ConnectorChatContextRow>(
    `SELECT id,
            connector_type,
            external_chat_id,
            external_thread_id,
            binding_id,
            workspace_id,
            discord_access_mode
       FROM connector_chat_contexts
      WHERE connector_type = $1
        AND external_chat_id = $2
        AND external_thread_id = $3
      LIMIT 1`,
    [input.connectorType, input.externalChatId, input.externalThreadId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  return mapChatContext(result.rows[0]);
}

export async function upsertConnectorChatContext(input: {
  connectorType: ConnectorType;
  externalChatId: string;
  externalThreadId: string;
  bindingId: string;
  workspaceId: string;
  discordAccessMode?: "restricted" | "open";
  updatedByUserId: string | null;
}): Promise<ConnectorChatContext> {
  const result = await query<ConnectorChatContextRow>(
    `INSERT INTO connector_chat_contexts (
      connector_type,
      external_chat_id,
      external_thread_id,
      binding_id,
      workspace_id,
      discord_access_mode,
      updated_by_user_id,
      updated_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      now()
    )
    ON CONFLICT (connector_type, external_chat_id, external_thread_id)
    DO UPDATE SET
      binding_id = EXCLUDED.binding_id,
      workspace_id = EXCLUDED.workspace_id,
      discord_access_mode = EXCLUDED.discord_access_mode,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now()
    RETURNING id,
              connector_type,
              external_chat_id,
              external_thread_id,
              binding_id,
              workspace_id,
              discord_access_mode`,
    [
      input.connectorType,
      input.externalChatId,
      input.externalThreadId,
      input.bindingId,
      input.workspaceId,
      input.discordAccessMode ?? "restricted",
      input.updatedByUserId
    ]
  );

  return mapChatContext(result.rows[0]);
}

export async function grantConnectorExternalAccess(input: {
  bindingId: string;
  workspaceId: string;
  externalUserId: string;
  grantedByUserId: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO connector_external_grants (
      binding_id,
      workspace_id,
      external_user_id,
      granted_by_user_id,
      updated_at
    ) VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (binding_id, external_user_id)
    DO UPDATE SET
      granted_by_user_id = EXCLUDED.granted_by_user_id,
      updated_at = now()`,
    [input.bindingId, input.workspaceId, input.externalUserId, input.grantedByUserId]
  );
}

export async function revokeConnectorExternalAccess(input: {
  bindingId: string;
  externalUserId: string;
}): Promise<boolean> {
  const result = await query(
    `DELETE FROM connector_external_grants
      WHERE binding_id = $1
        AND external_user_id = $2`,
    [input.bindingId, input.externalUserId]
  );

  return (result.rowCount ?? 0) > 0;
}
