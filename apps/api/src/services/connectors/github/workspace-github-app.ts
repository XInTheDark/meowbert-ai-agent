import { createPrivateKey } from "node:crypto";
import { buildGitHubRuntimeEnv, normalizeGitHubAppPrivateKeyPem } from "@meowbert/shared";
import { query, withTransaction } from "../../../lib/db.js";
import {
  listGitHubAppInstallations,
  mintGitHubInstallationToken,
  type GitHubAppInstallationSummary
} from "./app-auth.js";

export interface WorkspaceGitHubApp {
  workspace_id: string;
  configured_by_user_id: string | null;
  app_id: string;
  app_slug: string;
  private_key_pem: string;
  webhook_secret: string;
  client_id: string | null;
  client_secret: string | null;
  default_org: string | null;
  installation_id: string | null;
  installation_account_login: string | null;
  installation_account_type: "User" | "Organization" | null;
  installation_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceGitHubInstallStateRow {
  state: string;
  workspace_id: string;
  user_id: string;
  return_origin: string;
  expires_at: string;
  consumed_at: string | null;
}

function normalizeNonEmptyText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeLiteralPemNewlinesInJson(rawJson: string): string {
  return rawJson.replace(
    /("privateKeyPem"|"private_key_pem")\s*:\s*"([\s\S]*?)"/g,
    (fullMatch, fieldName: string, fieldValue: string) => {
      if (!fieldValue.includes("\n") && !fieldValue.includes("\r")) {
        return fullMatch;
      }

      const escaped = fieldValue
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n/g, "\\n");

      return `${fieldName}: "${escaped}"`;
    }
  );
}

export function normalizeGitHubAppId(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error("Invalid GitHub App ID");
  }

  return numeric;
}

export function normalizeGitHubAppSlug(value: string): string {
  const normalized = value.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(normalized)) {
    throw new Error("Invalid GitHub App slug");
  }

  return normalized;
}

export function normalizeGitHubOrg(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(trimmed)) {
    throw new Error("Invalid GitHub organization name");
  }

  return trimmed;
}

function normalizeAndValidateGitHubAppPrivateKeyPem(value: string): string {
  const normalized = normalizeGitHubAppPrivateKeyPem(value);
  try {
    createPrivateKey(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub App config privateKeyPem is invalid or unsupported: ${message}`);
  }

  return normalized;
}

export async function getWorkspaceGitHubApp(workspaceId: string): Promise<WorkspaceGitHubApp | null> {
  const result = await query<WorkspaceGitHubApp>(
    `SELECT workspace_id,
            configured_by_user_id,
            app_id::text,
            app_slug,
            private_key_pem,
            webhook_secret,
            client_id,
            client_secret,
            default_org,
            installation_id::text,
            installation_account_login,
            installation_account_type,
            installation_connected_at::text,
            created_at::text,
            updated_at::text
       FROM workspace_github_apps
      WHERE workspace_id = $1
      LIMIT 1`,
    [workspaceId]
  );

  return result.rows[0] ?? null;
}

export async function buildWorkspaceGitHubShellEnvFromApp(
  workspaceId: string
): Promise<Record<string, string>> {
  const appConfig = await getWorkspaceGitHubApp(workspaceId);
  if (!appConfig || !appConfig.installation_id) {
    return {};
  }

  const appId = Number.parseInt(appConfig.app_id, 10);
  const installationId = Number.parseInt(appConfig.installation_id, 10);
  if (!Number.isInteger(appId) || appId <= 0 || !Number.isInteger(installationId) || installationId <= 0) {
    return {};
  }

  try {
    const token = await mintGitHubInstallationToken({
      appId,
      privateKeyPem: appConfig.private_key_pem,
      installationId
    });
    return buildGitHubRuntimeEnv({
      accessToken: token.token,
      login: appConfig.app_slug,
      name: `${appConfig.app_slug}[bot]`,
      defaultOrg: appConfig.default_org,
      contentsPermission: token.contentsPermission,
      repositorySelection: token.repositorySelection
    });
  } catch {
    return {};
  }
}

export async function inspectWorkspaceGitHubAppInstallationAccess(appConfig: WorkspaceGitHubApp): Promise<{
  ok: boolean;
  error: string | null;
  expiresAt: string | null;
  repositorySelection: string | null;
  contentsPermission: string | null;
  canReadContents: boolean;
  canWriteContents: boolean;
}> {
  if (!appConfig.installation_id) {
    return {
      ok: false,
      error: "No GitHub App installation is connected.",
      expiresAt: null,
      repositorySelection: null,
      contentsPermission: null,
      canReadContents: false,
      canWriteContents: false
    };
  }

  const appId = Number.parseInt(appConfig.app_id, 10);
  const installationId = Number.parseInt(appConfig.installation_id, 10);
  if (!Number.isInteger(appId) || appId <= 0 || !Number.isInteger(installationId) || installationId <= 0) {
    return {
      ok: false,
      error: "GitHub App or installation ID is invalid.",
      expiresAt: null,
      repositorySelection: null,
      contentsPermission: null,
      canReadContents: false,
      canWriteContents: false
    };
  }

  try {
    const token = await mintGitHubInstallationToken({
      appId,
      privateKeyPem: appConfig.private_key_pem,
      installationId
    });
    return {
      ok: true,
      error: null,
      expiresAt: token.expiresAt,
      repositorySelection: token.repositorySelection,
      contentsPermission: token.contentsPermission,
      canReadContents: token.canReadContents,
      canWriteContents: token.canWriteContents
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      expiresAt: null,
      repositorySelection: null,
      contentsPermission: null,
      canReadContents: false,
      canWriteContents: false
    };
  }
}

export async function getWorkspaceGitHubAppByInstallationId(
  installationId: number
): Promise<WorkspaceGitHubApp | null> {
  const result = await query<WorkspaceGitHubApp>(
    `SELECT workspace_id,
            configured_by_user_id,
            app_id::text,
            app_slug,
            private_key_pem,
            webhook_secret,
            client_id,
            client_secret,
            default_org,
            installation_id::text,
            installation_account_login,
            installation_account_type,
            installation_connected_at::text,
            created_at::text,
            updated_at::text
       FROM workspace_github_apps
      WHERE installation_id = $1
      LIMIT 1`,
    [installationId]
  );

  return result.rows[0] ?? null;
}

export async function upsertWorkspaceGitHubApp(input: {
  workspaceId: string;
  configuredByUserId: string;
  appId: number;
  appSlug: string;
  privateKeyPem: string;
  webhookSecret: string;
  clientId: string | null;
  clientSecret: string | null;
  defaultOrg: string | null;
}): Promise<WorkspaceGitHubApp> {
  const result = await query<WorkspaceGitHubApp>(
    `INSERT INTO workspace_github_apps (
      workspace_id,
      configured_by_user_id,
      app_id,
      app_slug,
      private_key_pem,
      webhook_secret,
      client_id,
      client_secret,
      default_org,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
    ON CONFLICT (workspace_id)
    DO UPDATE SET
      configured_by_user_id = EXCLUDED.configured_by_user_id,
      app_id = EXCLUDED.app_id,
      app_slug = EXCLUDED.app_slug,
      private_key_pem = EXCLUDED.private_key_pem,
      webhook_secret = EXCLUDED.webhook_secret,
      client_id = EXCLUDED.client_id,
      client_secret = EXCLUDED.client_secret,
      default_org = EXCLUDED.default_org,
      installation_id = CASE
        WHEN workspace_github_apps.app_id <> EXCLUDED.app_id
          OR workspace_github_apps.app_slug <> EXCLUDED.app_slug
          THEN NULL
        ELSE workspace_github_apps.installation_id
      END,
      installation_account_login = CASE
        WHEN workspace_github_apps.app_id <> EXCLUDED.app_id
          OR workspace_github_apps.app_slug <> EXCLUDED.app_slug
          THEN NULL
        ELSE workspace_github_apps.installation_account_login
      END,
      installation_account_type = CASE
        WHEN workspace_github_apps.app_id <> EXCLUDED.app_id
          OR workspace_github_apps.app_slug <> EXCLUDED.app_slug
          THEN NULL
        ELSE workspace_github_apps.installation_account_type
      END,
      installation_connected_at = CASE
        WHEN workspace_github_apps.app_id <> EXCLUDED.app_id
          OR workspace_github_apps.app_slug <> EXCLUDED.app_slug
          THEN NULL
        ELSE workspace_github_apps.installation_connected_at
      END,
      updated_at = now()
    RETURNING workspace_id,
              configured_by_user_id,
              app_id::text,
              app_slug,
              private_key_pem,
              webhook_secret,
              client_id,
              client_secret,
              default_org,
              installation_id::text,
              installation_account_login,
              installation_account_type,
              installation_connected_at::text,
              created_at::text,
              updated_at::text`,
    [
      input.workspaceId,
      input.configuredByUserId,
      input.appId,
      input.appSlug,
      input.privateKeyPem,
      input.webhookSecret,
      input.clientId,
      input.clientSecret,
      input.defaultOrg
    ]
  );

  return result.rows[0];
}

export async function setWorkspaceGitHubAppInstallation(input: {
  workspaceId: string;
  installationId: number;
  accountLogin: string | null;
  accountType: "User" | "Organization" | null;
}): Promise<WorkspaceGitHubApp | null> {
  const result = await query<WorkspaceGitHubApp>(
    `UPDATE workspace_github_apps
        SET installation_id = $2,
            installation_account_login = $3,
            installation_account_type = $4,
            installation_connected_at = now(),
            updated_at = now()
      WHERE workspace_id = $1
      RETURNING workspace_id,
                configured_by_user_id,
                app_id::text,
                app_slug,
                private_key_pem,
                webhook_secret,
                client_id,
                client_secret,
                default_org,
                installation_id::text,
                installation_account_login,
                installation_account_type,
                installation_connected_at::text,
                created_at::text,
                updated_at::text`,
    [input.workspaceId, input.installationId, input.accountLogin, input.accountType]
  );

  return result.rows[0] ?? null;
}

function formatInstallationAccounts(installations: GitHubAppInstallationSummary[]): string {
  return installations
    .map((installation) => installation.accountLogin)
    .filter((login): login is string => typeof login === "string" && login.length > 0)
    .slice(0, 5)
    .join(", ");
}

export function selectExistingGitHubInstallation(input: {
  installations: GitHubAppInstallationSummary[];
  preferredAccountLogin: string | null;
}): GitHubAppInstallationSummary {
  const installations = input.installations.filter((installation) => (
    Number.isInteger(installation.installationId) && installation.installationId > 0
  ));
  if (installations.length === 0) {
    throw new Error("No existing GitHub App installations were found for this app.");
  }

  const preferredAccountLogin = normalizeNonEmptyText(input.preferredAccountLogin)?.toLowerCase() ?? null;
  if (preferredAccountLogin) {
    const matchedInstallation = installations.find((installation) => (
      installation.accountLogin?.toLowerCase() === preferredAccountLogin
    ));
    if (!matchedInstallation) {
      const accountList = formatInstallationAccounts(installations);
      throw new Error(
        accountList
          ? `No existing GitHub App installation was found for ${input.preferredAccountLogin}. Available accounts: ${accountList}.`
          : `No existing GitHub App installation was found for ${input.preferredAccountLogin}.`
      );
    }

    return matchedInstallation;
  }

  if (installations.length === 1) {
    return installations[0];
  }

  const accountList = formatInstallationAccounts(installations);
  throw new Error(
    accountList
      ? `Found multiple existing GitHub App installations (${accountList}). Set defaultOrg in the config JSON to the GitHub account or organization to connect.`
      : "Found multiple existing GitHub App installations. Set defaultOrg in the config JSON to the GitHub account or organization to connect."
  );
}

export async function connectWorkspaceGitHubExistingInstallation(workspaceId: string): Promise<WorkspaceGitHubApp> {
  const appConfig = await getWorkspaceGitHubApp(workspaceId);
  if (!appConfig) {
    throw new Error("Save GitHub App credentials for this workspace first.");
  }

  const appId = Number.parseInt(appConfig.app_id, 10);
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error("Configured GitHub App ID is invalid.");
  }

  const installation = selectExistingGitHubInstallation({
    installations: await listGitHubAppInstallations({
      appId,
      privateKeyPem: appConfig.private_key_pem
    }),
    preferredAccountLogin: appConfig.default_org
  });
  const updated = await setWorkspaceGitHubAppInstallation({
    workspaceId,
    installationId: installation.installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType
  });
  if (!updated) {
    throw new Error("No GitHub App is configured for this workspace.");
  }

  return updated;
}

export async function clearWorkspaceGitHubAppInstallation(workspaceId: string): Promise<void> {
  await query(
    `UPDATE workspace_github_apps
        SET installation_id = NULL,
            installation_account_login = NULL,
            installation_account_type = NULL,
            installation_connected_at = NULL,
            updated_at = now()
      WHERE workspace_id = $1`,
    [workspaceId]
  );
}

export async function deleteWorkspaceGitHubApp(workspaceId: string): Promise<void> {
  await query(`DELETE FROM workspace_github_apps WHERE workspace_id = $1`, [workspaceId]);
  await query(`DELETE FROM workspace_github_install_states WHERE workspace_id = $1`, [workspaceId]);
}

export async function createWorkspaceGitHubInstallState(input: {
  workspaceId: string;
  userId: string;
  returnOrigin: string;
  ttlMinutes: number;
  state: string;
}): Promise<string> {
  const result = await query<{ expires_at: string }>(
    `INSERT INTO workspace_github_install_states (
      state,
      workspace_id,
      user_id,
      return_origin,
      expires_at
    )
    VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
    RETURNING expires_at::text`,
    [input.state, input.workspaceId, input.userId, input.returnOrigin, input.ttlMinutes]
  );

  return result.rows[0].expires_at;
}

export async function consumeWorkspaceGitHubInstallState(state: string): Promise<{
  workspaceId: string;
  userId: string;
  returnOrigin: string;
} | null> {
  return withTransaction(async (client) => {
    const result = await client.query<WorkspaceGitHubInstallStateRow>(
      `SELECT state,
              workspace_id,
              user_id,
              return_origin,
              expires_at::text,
              consumed_at::text
         FROM workspace_github_install_states
        WHERE state = $1
        FOR UPDATE`,
      [state]
    );

    if ((result.rowCount ?? 0) === 0) {
      return null;
    }

    const row = result.rows[0];
    const expired = new Date(row.expires_at).getTime() <= Date.now();
    if (row.consumed_at || expired) {
      if (!row.consumed_at) {
        await client.query(
          `UPDATE workspace_github_install_states
              SET consumed_at = now()
            WHERE state = $1`,
          [state]
        );
      }
      return null;
    }

    await client.query(
      `UPDATE workspace_github_install_states
          SET consumed_at = now()
        WHERE state = $1`,
      [state]
    );

    return {
      workspaceId: row.workspace_id,
      userId: row.user_id,
      returnOrigin: row.return_origin
    };
  });
}

export function parseWorkspaceGitHubAppConfigJson(rawJson: string): {
  appId: number;
  appSlug: string;
  privateKeyPem: string;
  webhookSecret: string;
  clientId: string | null;
  clientSecret: string | null;
  defaultOrg: string | null;
} {
  let parsed: unknown | undefined;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    const repairedJson = escapeLiteralPemNewlinesInJson(rawJson);
    if (repairedJson !== rawJson) {
      try {
        parsed = JSON.parse(repairedJson);
      } catch {
        // Fall through to the user-facing JSON error below.
      }
    }

    if (parsed === undefined) {
      throw new Error(
        "GitHub App config must be valid JSON. For privateKeyPem, keep it as one JSON string and escape line breaks as \\n."
      );
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GitHub App config must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const appIdRaw = record.appId ?? record.app_id;
  const appSlugRaw = record.appSlug ?? record.app_slug;
  const privateKeyPemRaw = record.privateKeyPem ?? record.private_key_pem;
  const webhookSecretRaw = record.webhookSecret ?? record.webhook_secret;

  if ((typeof appIdRaw !== "string" && typeof appIdRaw !== "number") || typeof appSlugRaw !== "string") {
    throw new Error("GitHub App config requires appId and appSlug.");
  }

  if (typeof privateKeyPemRaw !== "string" || privateKeyPemRaw.trim().length === 0) {
    throw new Error("GitHub App config requires privateKeyPem.");
  }

  if (typeof webhookSecretRaw !== "string" || webhookSecretRaw.trim().length === 0) {
    throw new Error("GitHub App config requires webhookSecret.");
  }

  const privateKeyPem = normalizeAndValidateGitHubAppPrivateKeyPem(privateKeyPemRaw);

  return {
    appId: normalizeGitHubAppId(appIdRaw),
    appSlug: normalizeGitHubAppSlug(appSlugRaw),
    privateKeyPem,
    webhookSecret: webhookSecretRaw.trim(),
    clientId: normalizeNonEmptyText(
      typeof record.clientId === "string"
        ? record.clientId
        : typeof record.client_id === "string"
          ? record.client_id
          : null
    ),
    clientSecret: normalizeNonEmptyText(
      typeof record.clientSecret === "string"
        ? record.clientSecret
        : typeof record.client_secret === "string"
          ? record.client_secret
          : null
    ),
    defaultOrg: normalizeGitHubOrg(
      typeof record.defaultOrg === "string"
        ? record.defaultOrg
        : typeof record.default_org === "string"
          ? record.default_org
          : null
    )
  };
}
