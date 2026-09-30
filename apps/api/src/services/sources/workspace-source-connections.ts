import { query } from "../../lib/db.js";
import type { SourceProvider, StoredSourceTokens, WorkspaceSourceConnection } from "./source-types.js";

interface WorkspaceSourceConnectionRow {
  workspace_id: string;
  provider: SourceProvider;
  tokens_json: unknown;
  account_id: string | null;
  account_label: string | null;
  connected_at: string;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readScopeStrings(tokens: StoredSourceTokens): string[] {
  const values = new Set<string>();
  const pushValue = (value: unknown) => {
    if (typeof value === "string") {
      value
        .split(/\s+/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0)
        .forEach((part) => values.add(part));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => pushValue(entry));
    }
  };

  pushValue(tokens.scope);
  pushValue(tokens.raw.scope);
  pushValue(tokens.raw.scp);
  pushValue(tokens.raw.scopes);

  return Array.from(values);
}

export function sourceConnectionCanWrite(connection: WorkspaceSourceConnection): boolean {
  const scopes = readScopeStrings(connection.tokens);

  if (connection.provider === "onedrive") {
    return scopes.some((scope) => scope.startsWith("files.readwrite"));
  }

  if (connection.provider === "google-drive") {
    return scopes.some((scope) => (
      scope === "https://www.googleapis.com/auth/drive"
      || scope === "https://www.googleapis.com/auth/drive.file"
      || scope === "drive"
      || scope === "drive.file"
    ));
  }

  if (connection.provider === "outlook") {
    return scopes.some((scope) => scope.startsWith("calendars.readwrite"));
  }

  if (connection.provider === "pcloud" || connection.provider === "rclone") {
    return true;
  }

  return false;
}

export function parseStoredSourceTokens(raw: unknown): StoredSourceTokens {
  const record = isPlainObject(raw) ? raw : {};
  const accessToken = typeof record.accessToken === "string"
    ? record.accessToken
    : typeof record.access_token === "string"
      ? record.access_token
      : "";
  const refreshToken = typeof record.refreshToken === "string"
    ? record.refreshToken
    : typeof record.refresh_token === "string"
      ? record.refresh_token
      : null;
  const expiresAt = typeof record.expiresAt === "string"
    ? record.expiresAt
    : typeof record.expires_at === "string"
      ? record.expires_at
      : null;
  const scope = typeof record.scope === "string" ? record.scope : null;
  const tokenType = typeof record.tokenType === "string"
    ? record.tokenType
    : typeof record.token_type === "string"
      ? record.token_type
      : null;
  const tokenRaw = isPlainObject(record.raw) ? record.raw : record;

  if (!accessToken) {
    throw new Error("Workspace source connection is missing an access token.");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope,
    tokenType,
    raw: tokenRaw
  };
}

function mapWorkspaceSourceConnection(row: WorkspaceSourceConnectionRow): WorkspaceSourceConnection {
  return {
    workspaceId: row.workspace_id,
    provider: row.provider,
    tokens: parseStoredSourceTokens(row.tokens_json),
    accountId: row.account_id,
    accountLabel: row.account_label,
    connectedAt: row.connected_at,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listWorkspaceSourceConnections(workspaceId: string): Promise<WorkspaceSourceConnection[]> {
  const result = await query<WorkspaceSourceConnectionRow>(
    `SELECT workspace_id,
            provider,
            tokens_json,
            account_id,
            account_label,
            connected_at::text,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM workspace_source_connections
      WHERE workspace_id = $1
      ORDER BY provider ASC`,
    [workspaceId]
  );

  return result.rows.map(mapWorkspaceSourceConnection);
}

export async function getWorkspaceSourceConnection(
  workspaceId: string,
  provider: SourceProvider
): Promise<WorkspaceSourceConnection | null> {
  const result = await query<WorkspaceSourceConnectionRow>(
    `SELECT workspace_id,
            provider,
            tokens_json,
            account_id,
            account_label,
            connected_at::text,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM workspace_source_connections
      WHERE workspace_id = $1
        AND provider = $2
      LIMIT 1`,
    [workspaceId, provider]
  );

  return result.rows[0] ? mapWorkspaceSourceConnection(result.rows[0]) : null;
}

export async function upsertWorkspaceSourceConnection(input: {
  workspaceId: string;
  provider: SourceProvider;
  tokens: StoredSourceTokens;
  accountId: string | null;
  accountLabel: string | null;
  updatedByUserId: string | null;
}): Promise<WorkspaceSourceConnection> {
  const result = await query<WorkspaceSourceConnectionRow>(
    `INSERT INTO workspace_source_connections (
       workspace_id,
       provider,
       tokens_json,
       account_id,
       account_label,
       connected_at,
       updated_by_user_id
     )
     VALUES ($1, $2, $3::jsonb, $4, $5, now(), $6)
     ON CONFLICT (workspace_id, provider)
     DO UPDATE SET
       tokens_json = EXCLUDED.tokens_json,
       account_id = EXCLUDED.account_id,
       account_label = EXCLUDED.account_label,
       connected_at = COALESCE(workspace_source_connections.connected_at, EXCLUDED.connected_at),
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = now()
     RETURNING workspace_id,
               provider,
               tokens_json,
               account_id,
               account_label,
               connected_at::text,
               updated_by_user_id,
               created_at::text,
               updated_at::text`,
    [
      input.workspaceId,
      input.provider,
      JSON.stringify(input.tokens),
      input.accountId,
      input.accountLabel,
      input.updatedByUserId
    ]
  );

  return mapWorkspaceSourceConnection(result.rows[0]);
}

export async function deleteWorkspaceSourceConnection(workspaceId: string, provider: SourceProvider): Promise<void> {
  await query(
    `DELETE FROM workspace_source_connections
      WHERE workspace_id = $1
        AND provider = $2`,
    [workspaceId, provider]
  );
}
