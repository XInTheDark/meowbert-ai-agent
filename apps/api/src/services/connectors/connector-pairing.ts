import { randomBytes } from "node:crypto";
import type { ConnectorType } from "@meowbert/shared";
import type { QueryResult } from "pg";
import { query, withTransaction } from "../../lib/db.js";

const PAIR_CODE_TTL_MINUTES = 10;
const PAIR_CODE_PREFIX = "PAIR-";
const PAIR_CODE_RANDOM_LENGTH = 8;
const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CODE_GENERATION_ATTEMPTS = 8;

interface PairCodeRow {
  id: string;
  binding_id: string;
  workspace_id: string;
  user_id: string;
  code: string;
  expires_at: Date;
  consumed_at: Date | null;
}

interface PairingOwnerRow {
  user_id: string;
}

interface BindingScopeRow {
  type: ConnectorType;
  connection_mode: string;
}

function generatePairCodeRandomPart(length: number): string {
  const bytes = randomBytes(length);
  let output = "";
  for (let index = 0; index < length; index += 1) {
    const alphabetIndex = bytes[index] % PAIR_CODE_ALPHABET.length;
    output += PAIR_CODE_ALPHABET[alphabetIndex];
  }
  return output;
}

function generatePairCode(): string {
  return `${PAIR_CODE_PREFIX}${generatePairCodeRandomPart(PAIR_CODE_RANDOM_LENGTH)}`;
}

function extractPairCodeCandidate(messageText: string): string | null {
  const match = messageText.toUpperCase().match(/\bPAIR-[A-Z0-9]{8}\b/);
  if (!match) {
    return null;
  }

  return match[0];
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
  );
}

export interface ConnectorPairCodeResult {
  code: string;
  expiresAt: string;
}

export async function createConnectorPairCode(input: {
  bindingId: string;
  workspaceId: string;
  userId: string;
}): Promise<ConnectorPairCodeResult> {
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const nextCode = generatePairCode();

    try {
      return await withTransaction(async (client) => {
        await client.query(
          `UPDATE connector_pair_codes
              SET consumed_at = now()
            WHERE binding_id = $1
              AND user_id = $2
              AND consumed_at IS NULL`,
          [input.bindingId, input.userId]
        );

        const inserted = await client.query<{ expires_at: string }>(
          `INSERT INTO connector_pair_codes (
            binding_id,
            workspace_id,
            user_id,
            code,
            expires_at
          ) VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
          RETURNING expires_at`,
          [input.bindingId, input.workspaceId, input.userId, nextCode, PAIR_CODE_TTL_MINUTES]
        );

        return {
          code: nextCode,
          expiresAt: inserted.rows[0].expires_at
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to generate a unique pairing code. Please try again.");
}

export interface ConsumeConnectorPairCodeResult {
  handled: boolean;
  outcome?: "paired" | "expired" | "already_used" | "already_linked" | "invalid";
  userId?: string;
}

export async function consumeConnectorPairCodeIfPresent(input: {
  bindingId: string;
  workspaceId: string;
  externalUserId: string;
  messageText: string;
}): Promise<ConsumeConnectorPairCodeResult> {
  const pairCode = extractPairCodeCandidate(input.messageText);
  if (!pairCode) {
    return { handled: false };
  }

  try {
    return await withTransaction(async (client) => {
      const codeRes = await client.query<PairCodeRow>(
        `SELECT id, binding_id, workspace_id, user_id, code, expires_at, consumed_at
           FROM connector_pair_codes
          WHERE binding_id = $1
            AND code = $2
          LIMIT 1
          FOR UPDATE`,
        [input.bindingId, pairCode]
      );

      if ((codeRes.rowCount ?? 0) === 0) {
        return { handled: true, outcome: "invalid" };
      }

      const codeRow = codeRes.rows[0];
      if (codeRow.workspace_id !== input.workspaceId) {
        return { handled: true, outcome: "invalid" };
      }

      if (codeRow.consumed_at) {
        return { handled: true, outcome: "already_used" };
      }

      if (new Date(codeRow.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE connector_pair_codes
              SET consumed_at = now()
            WHERE id = $1`,
          [codeRow.id]
        );
        return { handled: true, outcome: "expired" };
      }

      const bindingScopeRes = await client.query<BindingScopeRow>(
        `SELECT type,
                COALESCE(config_json->>'connectionMode', 'custom') AS connection_mode
           FROM connector_bindings
          WHERE id = $1
          LIMIT 1`,
        [input.bindingId]
      );

      if ((bindingScopeRes.rowCount ?? 0) > 0) {
        const bindingScope = bindingScopeRes.rows[0];
        if (bindingScope.connection_mode === "shared") {
          const crossWorkspaceRes = await client.query<PairingOwnerRow>(
            `SELECT cp.user_id
               FROM connector_pairings cp
               JOIN connector_bindings cb ON cb.id = cp.binding_id
              WHERE cb.type = $1
                AND cb.status = 'active'
                AND COALESCE(cb.config_json->>'connectionMode', 'custom') = 'shared'
                AND cp.external_user_id = $2
                AND cp.user_id <> $3
              LIMIT 1`,
            [bindingScope.type, input.externalUserId, codeRow.user_id]
          );

          if ((crossWorkspaceRes.rowCount ?? 0) > 0) {
            return {
              handled: true,
              outcome: "already_linked",
              userId: crossWorkspaceRes.rows[0].user_id
            };
          }
        }
      }

      const existingPairingRes: QueryResult<PairingOwnerRow> = await client.query<PairingOwnerRow>(
        `SELECT user_id
           FROM connector_pairings
          WHERE binding_id = $1
            AND external_user_id = $2
          LIMIT 1`,
        [input.bindingId, input.externalUserId]
      );

      if ((existingPairingRes.rowCount ?? 0) > 0) {
        const ownerUserId = existingPairingRes.rows[0].user_id;
        if (ownerUserId !== codeRow.user_id) {
          return { handled: true, outcome: "already_linked", userId: ownerUserId };
        }
      }

      await client.query(
        `INSERT INTO connector_pairings (
          binding_id,
          workspace_id,
          user_id,
          external_user_id,
          paired_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT (binding_id, user_id)
        DO UPDATE SET
          external_user_id = EXCLUDED.external_user_id,
          paired_at = now(),
          updated_at = now()`,
        [input.bindingId, input.workspaceId, codeRow.user_id, input.externalUserId]
      );

      await client.query(
        `UPDATE connector_pair_codes
            SET consumed_at = now()
          WHERE id = $1`,
        [codeRow.id]
      );

      return {
        handled: true,
        outcome: "paired",
        userId: codeRow.user_id
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { handled: true, outcome: "already_linked" };
    }
    throw error;
  }
}

export async function consumeConnectorPairCodeForConnectorIfPresent(input: {
  connectorType: ConnectorType;
  externalUserId: string;
  messageText: string;
}): Promise<ConsumeConnectorPairCodeResult> {
  const pairCode = extractPairCodeCandidate(input.messageText);
  if (!pairCode) {
    return { handled: false };
  }

  const pairCodeLookup = await query<{ binding_id: string; workspace_id: string }>(
    `SELECT cpc.binding_id,
            cpc.workspace_id
       FROM connector_pair_codes cpc
       JOIN connector_bindings cb ON cb.id = cpc.binding_id
      WHERE cpc.code = $1
        AND cb.type = $2
        AND cb.status = 'active'
        AND COALESCE(cb.config_json->>'connectionMode', 'custom') = 'shared'
      LIMIT 1`,
    [pairCode, input.connectorType]
  );

  if ((pairCodeLookup.rowCount ?? 0) === 0) {
    return { handled: true, outcome: "invalid" };
  }

  const target = pairCodeLookup.rows[0];
  return consumeConnectorPairCodeIfPresent({
    bindingId: target.binding_id,
    workspaceId: target.workspace_id,
    externalUserId: input.externalUserId,
    messageText: pairCode
  });
}

export async function isConnectorExternalUserPaired(input: {
  bindingId: string;
  externalUserId: string;
  includeExternalGrants?: boolean;
}): Promise<boolean> {
  const pairingRes = await query(
    input.includeExternalGrants
      ? `SELECT 1
           FROM (
             SELECT 1
               FROM connector_pairings
              WHERE binding_id = $1
                AND external_user_id = $2
             UNION ALL
             SELECT 1
               FROM connector_external_grants
              WHERE binding_id = $1
                AND external_user_id = $2
           ) matches
          LIMIT 1`
      : `SELECT 1
           FROM connector_pairings
          WHERE binding_id = $1
            AND external_user_id = $2
          LIMIT 1`,
    [input.bindingId, input.externalUserId]
  );

  return (pairingRes.rowCount ?? 0) > 0;
}

export async function resolveConnectorPairedUserId(input: {
  bindingId: string;
  externalUserId: string;
}): Promise<string | null> {
  const pairingRes = await query<PairingOwnerRow>(
    `SELECT DISTINCT user_id
       FROM connector_pairings
      WHERE binding_id = $1
        AND external_user_id = $2
      LIMIT 2`,
    [input.bindingId, input.externalUserId]
  );

  if ((pairingRes.rowCount ?? 0) === 0) {
    return null;
  }

  const distinctUserIds = new Set(pairingRes.rows.map((row) => row.user_id));
  if (distinctUserIds.size > 1) {
    throw new Error("Connector external user is paired with multiple workspace users");
  }

  return pairingRes.rows[0].user_id;
}

export function pairingInstructionsForConnector(type: ConnectorType): string {
  if (type === "telegram") {
    return "Send this code to your Telegram bot in a direct message.";
  }

  if (type === "github") {
    return "Post this code in a GitHub issue or pull request comment where the GitHub connector can read it.";
  }

  if (type === "email") {
    return "Email connectors do not require pairing codes.";
  }

  return "Send this code to your Discord bot (DM or mention it in a server channel).";
}
