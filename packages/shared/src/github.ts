export interface GitHubRuntimeCredentials {
  accessToken: string;
  login: string;
  name?: string | null;
  email?: string | null;
  defaultOrg?: string | null;
  contentsPermission?: string | null;
  repositorySelection?: string | null;
}

export interface GitHubInstallationAccessSummary {
  permissions: Record<string, string>;
  repositorySelection: string | null;
  contentsPermission: string | null;
  canReadContents: boolean;
  canWriteContents: boolean;
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePermissionMap(value: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, rawPermission] of Object.entries(value)) {
    if (typeof rawPermission !== "string") {
      continue;
    }

    const permission = rawPermission.trim().toLowerCase();
    if (permission.length > 0) {
      normalized[key] = permission;
    }
  }

  return normalized;
}

export function summarizeGitHubInstallationAccess(input: {
  permissions?: Record<string, unknown> | null;
  repositorySelection?: unknown;
}): GitHubInstallationAccessSummary {
  const permissions = normalizePermissionMap(input.permissions);
  const repositorySelection = typeof input.repositorySelection === "string"
    ? normalizeNonEmpty(input.repositorySelection.toLowerCase())
    : null;
  const contentsPermission = permissions.contents ?? null;

  return {
    permissions,
    repositorySelection,
    contentsPermission,
    canReadContents: contentsPermission === "read" || contentsPermission === "write" || contentsPermission === "admin",
    canWriteContents: contentsPermission === "write" || contentsPermission === "admin"
  };
}

function maybeParseJsonString(value: string): string {
  if (!value.startsWith("\"") || !value.endsWith("\"")) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

export function normalizeGitHubAppPrivateKeyPem(value: string): string {
  return maybeParseJsonString(value.trim())
    .trim()
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

export function buildGitHubRuntimeEnv(
  credentials: GitHubRuntimeCredentials | null | undefined
): Record<string, string> {
  const token = normalizeNonEmpty(credentials?.accessToken);
  const login = normalizeNonEmpty(credentials?.login);
  if (!token || !login) {
    return {};
  }

  const displayName = normalizeNonEmpty(credentials?.name) ?? login;
  const email = normalizeNonEmpty(credentials?.email) ?? `${login}@users.noreply.github.com`;
  const defaultOrg = normalizeNonEmpty(credentials?.defaultOrg);
  const tokenizedGithubBaseUrl = `https://x-access-token:${token}@github.com/`;

  const environment: Record<string, string> = {
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: displayName,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: displayName,
    GIT_COMMITTER_EMAIL: email,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${tokenizedGithubBaseUrl}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    MEOWBERT_GITHUB_LOGIN: login
  };

  if (defaultOrg) {
    environment.MEOWBERT_GITHUB_DEFAULT_ORG = defaultOrg;
  }
  const contentsPermission = normalizeNonEmpty(credentials?.contentsPermission);
  if (contentsPermission) {
    environment.MEOWBERT_GITHUB_CONTENTS_PERMISSION = contentsPermission;
  }
  const repositorySelection = normalizeNonEmpty(credentials?.repositorySelection);
  if (repositorySelection) {
    environment.MEOWBERT_GITHUB_REPOSITORY_SELECTION = repositorySelection;
  }

  return environment;
}
