import { withTransaction } from "../../lib/db.js";
import type { SourceProvider, WorkspaceSourceOauthState } from "./source-types.js";

const SOURCE_OAUTH_STATE_TTL_MINUTES = 15;

interface WorkspaceSourceOauthStateRow {
  state: string;
  workspace_id: string;
  user_id: string;
  provider: SourceProvider;
  code_verifier: string;
  browser_nonce_hash: string;
  return_origin: string;
  expires_at: string;
  created_at: string;
}

function mapWorkspaceSourceOauthState(row: WorkspaceSourceOauthStateRow): WorkspaceSourceOauthState {
  return {
    state: row.state,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    provider: row.provider,
    codeVerifier: row.code_verifier,
    browserNonceHash: row.browser_nonce_hash,
    returnOrigin: row.return_origin,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

export async function createWorkspaceSourceOauthState(input: {
  state: string;
  workspaceId: string;
  userId: string;
  provider: SourceProvider;
  codeVerifier: string;
  browserNonceHash: string;
  returnOrigin: string;
  ttlMinutes?: number;
}): Promise<{ expiresAt: string }> {
  const ttlMinutes = input.ttlMinutes ?? SOURCE_OAUTH_STATE_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM workspace_source_oauth_states
        WHERE workspace_id = $1
          AND provider = $2
          AND user_id = $3`,
      [input.workspaceId, input.provider, input.userId]
    );

    await client.query(
      `INSERT INTO workspace_source_oauth_states (
         state,
         workspace_id,
         user_id,
         provider,
         code_verifier,
         browser_nonce_hash,
         return_origin,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
      [
        input.state,
        input.workspaceId,
        input.userId,
        input.provider,
        input.codeVerifier,
        input.browserNonceHash,
        input.returnOrigin,
        expiresAt
      ]
    );
  });

  return { expiresAt };
}

export async function consumeWorkspaceSourceOauthState(input: {
  state: string;
  provider: SourceProvider;
  browserNonceHash: string;
}): Promise<WorkspaceSourceOauthState | null> {
  return withTransaction(async (client) => {
    const result = await client.query<WorkspaceSourceOauthStateRow>(
      `UPDATE workspace_source_oauth_states
          SET consumed_at = now()
        WHERE state = $1
          AND provider = $2
          AND browser_nonce_hash = $3
          AND consumed_at IS NULL
          AND expires_at > now()
      RETURNING state,
                workspace_id,
                user_id,
                provider,
                code_verifier,
                browser_nonce_hash,
                return_origin,
                expires_at::text,
                created_at::text`,
      [input.state, input.provider, input.browserNonceHash]
    );

    return result.rows[0] ? mapWorkspaceSourceOauthState(result.rows[0]) : null;
  });
}
