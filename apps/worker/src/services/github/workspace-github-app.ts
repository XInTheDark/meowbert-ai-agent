import { buildGitHubRuntimeEnv } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { mintGitHubInstallationToken } from "./github-app-auth.js";

export interface WorkspaceGitHubAppConnection {
  app_id: string;
  app_slug: string;
  private_key_pem: string;
  installation_id: string | null;
  default_org: string | null;
}

function parsePositiveInteger(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function getWorkspaceGitHubAppConnection(
  workspaceId: string
): Promise<WorkspaceGitHubAppConnection | null> {
  const result = await query<WorkspaceGitHubAppConnection>(
    `SELECT app_id::text,
            app_slug,
            private_key_pem,
            installation_id::text,
            default_org
       FROM workspace_github_apps
      WHERE workspace_id = $1
      LIMIT 1`,
    [workspaceId]
  );

  return result.rows[0] ?? null;
}

export async function mintGitHubInstallationAuthFromConnection(input: {
  connection: WorkspaceGitHubAppConnection;
  abortSignal?: AbortSignal;
}): Promise<{
  accessToken: string;
  expiresAt: string | null;
  login: string;
  defaultOrg: string | null;
  contentsPermission: string | null;
  repositorySelection: string | null;
  canReadContents: boolean;
  canWriteContents: boolean;
} | null> {
  const appId = parsePositiveInteger(input.connection.app_id);
  const installationId = parsePositiveInteger(input.connection.installation_id);
  if (!appId || !installationId) {
    return null;
  }

  const token = await mintGitHubInstallationToken({
    appId,
    privateKeyPem: input.connection.private_key_pem,
    installationId,
    abortSignal: input.abortSignal
  });

  return {
    accessToken: token.token,
    expiresAt: token.expiresAt,
    login: input.connection.app_slug,
    defaultOrg: input.connection.default_org,
    contentsPermission: token.contentsPermission,
    repositorySelection: token.repositorySelection,
    canReadContents: token.canReadContents,
    canWriteContents: token.canWriteContents
  };
}

export async function mintGitHubRuntimeEnvFromConnection(input: {
  connection: WorkspaceGitHubAppConnection;
  abortSignal?: AbortSignal;
}): Promise<{
  env: Record<string, string>;
  expiresAt: string | null;
  login: string;
  defaultOrg: string | null;
  contentsPermission: string | null;
  repositorySelection: string | null;
  canReadContents: boolean;
  canWriteContents: boolean;
} | null> {
  const auth = await mintGitHubInstallationAuthFromConnection({
    connection: input.connection,
    abortSignal: input.abortSignal
  });
  if (!auth) {
    return null;
  }

  const env = buildGitHubRuntimeEnv({
    accessToken: auth.accessToken,
    login: auth.login,
    name: `${auth.login}[bot]`,
    defaultOrg: auth.defaultOrg,
    contentsPermission: auth.contentsPermission,
    repositorySelection: auth.repositorySelection
  });

  return {
    env,
    expiresAt: auth.expiresAt,
    login: auth.login,
    defaultOrg: auth.defaultOrg,
    contentsPermission: auth.contentsPermission,
    repositorySelection: auth.repositorySelection,
    canReadContents: auth.canReadContents,
    canWriteContents: auth.canWriteContents
  };
}

export async function mintGitHubInstallationAuthForWorkspace(input: {
  workspaceId: string;
  abortSignal?: AbortSignal;
}): Promise<{
  accessToken: string;
  expiresAt: string | null;
  login: string;
  defaultOrg: string | null;
  contentsPermission: string | null;
  repositorySelection: string | null;
  canReadContents: boolean;
  canWriteContents: boolean;
} | null> {
  const connection = await getWorkspaceGitHubAppConnection(input.workspaceId);
  if (!connection) {
    return null;
  }

  return mintGitHubInstallationAuthFromConnection({
    connection,
    abortSignal: input.abortSignal
  });
}
