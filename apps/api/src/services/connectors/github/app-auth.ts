import { createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import {
  normalizeGitHubAppPrivateKeyPem,
  summarizeGitHubInstallationAccess,
  type GitHubInstallationAccessSummary
} from "@meowbert/shared";
import { config } from "../../../lib/config.js";

const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_INSTALL_STATE_TTL_MINUTES = 10;
export const DESKTOP_GITHUB_RETURN_ORIGIN = "desktop://meowbert";

interface GitHubInstallationTokenResponse {
  token?: string;
  expires_at?: string;
  permissions?: Record<string, unknown>;
  repository_selection?: string;
}

interface GitHubInstallationResponse {
  id?: number;
  account?: {
    login?: string;
    type?: string;
  };
}

export interface GitHubAppInstallationSummary {
  installationId: number;
  accountLogin: string | null;
  accountType: "User" | "Organization" | null;
}

interface GitHubApiErrorResponse {
  message?: string;
}

function base64UrlEncodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isGitHubConnectorEnabled(): boolean {
  return config.github?.enabled === true;
}

export function getGitHubInstallCallbackUrl(): string {
  const base = config.server.publicUrl.replace(/\/+$/, "");
  return `${base}/api/connectors/github/install/callback`;
}

export function getGitHubCentralWebhookUrl(): string {
  const base = config.server.publicUrl.replace(/\/+$/, "");
  return `${base}/api/connectors/github/webhook`;
}

export function normalizeInstallReturnOrigin(value: string | null | undefined): string {
  const trimmed = value?.trim();
  const fallback = new URL(config.server.publicUrl).origin;
  if (!trimmed) {
    return fallback;
  }

  if (trimmed === DESKTOP_GITHUB_RETURN_ORIGIN) {
    return DESKTOP_GITHUB_RETURN_ORIGIN;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid return origin");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid return origin");
  }

  return parsed.origin;
}

export function buildWorkspaceGitHubInstallRedirectUrl(input: {
  appSlug: string;
  state: string;
}): string {
  const params = new URLSearchParams({ state: input.state });
  return `https://github.com/apps/${encodeURIComponent(input.appSlug)}/installations/new?${params.toString()}`;
}

export function generateGitHubInstallState(): string {
  return randomBytes(24).toString("base64url");
}

export function createGitHubAppJwt(input: {
  appId: number;
  privateKeyPem: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlEncodeJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: input.appId
  });

  const unsignedToken = `${header}.${payload}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256")
      .update(unsignedToken)
      .end()
      .sign(normalizeGitHubAppPrivateKeyPem(input.privateKeyPem), "base64url");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub App private key is invalid or unsupported: ${message}`);
  }

  return `${unsignedToken}.${signature}`;
}

async function callGitHubAppApi<T>(input: {
  appJwt: string;
  path: string;
  method?: "GET" | "POST";
  payload?: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}${input.path}`, {
    method: input.method ?? (input.payload ? "POST" : "GET"),
    headers: {
      authorization: `Bearer ${input.appJwt}`,
      accept: "application/vnd.github+json",
      ...(input.payload ? { "content-type": "application/json" } : {}),
      "user-agent": "meowbert-api"
    },
    body: input.payload ? JSON.stringify(input.payload) : undefined
  });

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`GitHub API ${input.path} returned invalid JSON`);
  }

  if (!response.ok) {
    const errorPayload = parsed as GitHubApiErrorResponse | null;
    throw new Error(
      errorPayload && typeof errorPayload.message === "string"
        ? errorPayload.message
        : `GitHub API ${input.path} failed with HTTP ${response.status}`
    );
  }

  return parsed as T;
}

export async function mintGitHubInstallationToken(input: {
  appId: number;
  privateKeyPem: string;
  installationId: number;
}): Promise<{ token: string; expiresAt: string | null } & GitHubInstallationAccessSummary> {
  const appJwt = createGitHubAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem
  });

  const tokenResponse = await callGitHubAppApi<GitHubInstallationTokenResponse>({
    appJwt,
    path: `/app/installations/${input.installationId}/access_tokens`,
    method: "POST"
  });

  const token = normalizeNonEmpty(tokenResponse.token);
  if (!token) {
    throw new Error("GitHub installation token response did not include a token.");
  }

  return {
    token,
    expiresAt: normalizeNonEmpty(tokenResponse.expires_at),
    ...summarizeGitHubInstallationAccess({
      permissions: tokenResponse.permissions,
      repositorySelection: tokenResponse.repository_selection
    })
  };
}

export async function fetchGitHubInstallationDetails(input: {
  appId: number;
  privateKeyPem: string;
  installationId: number;
}): Promise<GitHubAppInstallationSummary> {
  const appJwt = createGitHubAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem
  });

  const installation = await callGitHubAppApi<GitHubInstallationResponse>({
    appJwt,
    path: `/app/installations/${input.installationId}`,
    method: "GET"
  });

  const installationId =
    typeof installation.id === "number" && Number.isInteger(installation.id) && installation.id > 0
      ? installation.id
      : null;
  if (!installationId) {
    throw new Error("GitHub installation response is missing a valid installation id.");
  }

  const accountTypeRaw = normalizeNonEmpty(installation.account?.type);
  const accountType =
    accountTypeRaw === "User" || accountTypeRaw === "Organization"
      ? accountTypeRaw
      : null;

  return {
    installationId,
    accountLogin: normalizeNonEmpty(installation.account?.login),
    accountType
  };
}

export async function listGitHubAppInstallations(input: {
  appId: number;
  privateKeyPem: string;
}): Promise<GitHubAppInstallationSummary[]> {
  const appJwt = createGitHubAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem
  });

  const installations = await callGitHubAppApi<GitHubInstallationResponse[]>({
    appJwt,
    path: "/app/installations?per_page=100",
    method: "GET"
  });

  if (!Array.isArray(installations)) {
    throw new Error("GitHub installations response is invalid.");
  }

  return installations.flatMap((installation) => {
    const installationId =
      typeof installation.id === "number" && Number.isInteger(installation.id) && installation.id > 0
        ? installation.id
        : null;
    if (!installationId) {
      return [];
    }

    const accountTypeRaw = normalizeNonEmpty(installation.account?.type);
    const accountType =
      accountTypeRaw === "User" || accountTypeRaw === "Organization"
        ? accountTypeRaw
        : null;

    return [
      {
        installationId,
        accountLogin: normalizeNonEmpty(installation.account?.login),
        accountType
      }
    ];
  });
}

export function verifyGitHubWebhookSignature(input: {
  rawBody: string;
  webhookSecret: string;
  signatureHeader: string | null;
}): boolean {
  const signatureHeader = normalizeNonEmpty(input.signatureHeader);
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", input.webhookSecret).update(input.rawBody, "utf8").digest("hex")}`;
  const providedBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
