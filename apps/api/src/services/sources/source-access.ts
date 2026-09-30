import { getSourceProviderClient } from "./provider-clients.js";
import { getSourceProviderSettings, isSourceProviderReady } from "./provider-settings.js";
import {
  getWorkspaceSourceConnection,
  upsertWorkspaceSourceConnection
} from "./workspace-source-connections.js";
import type { SourceProvider, SourceProviderSettings, WorkspaceSourceConnection } from "./source-types.js";

const SOURCE_TOKEN_REFRESH_LEEWAY_MS = 60_000;

class SourceAccessError extends Error {
  readonly statusCode = 409;
  readonly exposeMessage = true;

  constructor(message: string) {
    super(message);
    this.name = "SourceAccessError";
  }
}

function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= Date.now() + SOURCE_TOKEN_REFRESH_LEEWAY_MS;
}

async function refreshWorkspaceSourceConnection(input: {
  connection: WorkspaceSourceConnection;
  settings: SourceProviderSettings;
}): Promise<WorkspaceSourceConnection> {
  const refreshToken = input.connection.tokens.refreshToken;
  if (!refreshToken) {
    throw new SourceAccessError("This source connection has expired and must be reconnected.");
  }

  const providerClient = getSourceProviderClient(input.connection.provider);
  const refreshedTokens = await providerClient.refreshTokens({
    clientId: input.settings.clientId!,
    clientSecret: input.settings.clientSecret!,
    refreshToken
  });

  return upsertWorkspaceSourceConnection({
    workspaceId: input.connection.workspaceId,
    provider: input.connection.provider,
    tokens: {
      ...refreshedTokens,
      refreshToken: refreshedTokens.refreshToken ?? refreshToken
    },
    accountId: input.connection.accountId,
    accountLabel: input.connection.accountLabel,
    updatedByUserId: input.connection.updatedByUserId
  });
}

export async function resolveWorkspaceSourceAccess(input: {
  workspaceId: string;
  provider: SourceProvider;
  requiresAdminCredentials?: boolean;
}): Promise<{
  settings: SourceProviderSettings;
  connection: WorkspaceSourceConnection;
  accessToken: string;
}> {
  const [settings, connection] = await Promise.all([
    getSourceProviderSettings(input.provider),
    getWorkspaceSourceConnection(input.workspaceId, input.provider)
  ]);

  if (!isSourceProviderReady(settings, {
    requiresCredentials: input.requiresAdminCredentials ?? true
  })) {
    throw new SourceAccessError("This source provider is not configured by the server admin.");
  }
  if (!connection) {
    throw new SourceAccessError("This workspace has not connected the requested source yet.");
  }

  const activeConnection = isTokenExpired(connection.tokens.expiresAt)
    ? await refreshWorkspaceSourceConnection({ connection, settings })
    : connection;

  return {
    settings,
    connection: activeConnection,
    accessToken: activeConnection.tokens.accessToken
  };
}
