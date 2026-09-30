import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("./app-auth.js", () => ({
  listGitHubAppInstallations: vi.fn(),
  mintGitHubInstallationToken: vi.fn()
}));

import { mintGitHubInstallationToken } from "./app-auth.js";
import {
  inspectWorkspaceGitHubAppInstallationAccess,
  parseWorkspaceGitHubAppConfigJson,
  selectExistingGitHubInstallation,
  type WorkspaceGitHubApp
} from "./workspace-github-app.js";

const mockedMintGitHubInstallationToken = vi.mocked(mintGitHubInstallationToken);

describe("selectExistingGitHubInstallation", () => {
  it("uses the only existing installation when no account is preferred", () => {
    expect(
      selectExistingGitHubInstallation({
        preferredAccountLogin: null,
        installations: [
          {
            installationId: 123,
            accountLogin: "octocat",
            accountType: "User"
          }
        ]
      })
    ).toMatchObject({
      installationId: 123,
      accountLogin: "octocat"
    });
  });

  it("matches the configured account when multiple installations exist", () => {
    expect(
      selectExistingGitHubInstallation({
        preferredAccountLogin: "meowbert-org",
        installations: [
          {
            installationId: 123,
            accountLogin: "octocat",
            accountType: "User"
          },
          {
            installationId: 456,
            accountLogin: "Meowbert-Org",
            accountType: "Organization"
          }
        ]
      })
    ).toMatchObject({
      installationId: 456,
      accountLogin: "Meowbert-Org"
    });
  });

  it("requires an account hint when multiple installations exist", () => {
    expect(() =>
      selectExistingGitHubInstallation({
        preferredAccountLogin: null,
        installations: [
          {
            installationId: 123,
            accountLogin: "octocat",
            accountType: "User"
          },
          {
            installationId: 456,
            accountLogin: "Meowbert-Org",
            accountType: "Organization"
          }
        ]
      })
    ).toThrow("Found multiple existing GitHub App installations");
  });
});

describe("parseWorkspaceGitHubAppConfigJson", () => {
  it("normalizes escaped private key PEM values before storage", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const parsed = parseWorkspaceGitHubAppConfigJson(JSON.stringify({
      appId: 123,
      appSlug: "meowbert-app",
      privateKeyPem: privateKeyPem.replace(/\n/g, "\\n"),
      webhookSecret: "secret"
    }));

    expect(parsed.privateKeyPem).toBe(privateKeyPem.trim());
  });

  it("rejects private key values that OpenSSL cannot decode", () => {
    expect(() =>
      parseWorkspaceGitHubAppConfigJson(JSON.stringify({
        appId: 123,
        appSlug: "meowbert-app",
        privateKeyPem: "not a private key",
        webhookSecret: "secret"
      }))
    ).toThrow("GitHub App config privateKeyPem is invalid or unsupported");
  });
});

describe("inspectWorkspaceGitHubAppInstallationAccess", () => {
  const appConfig: WorkspaceGitHubApp = {
    workspace_id: "workspace-1",
    configured_by_user_id: "user-1",
    app_id: "123",
    app_slug: "meowbert-app",
    private_key_pem: "pem",
    webhook_secret: "secret",
    client_id: null,
    client_secret: null,
    default_org: "octocat",
    installation_id: "456",
    installation_account_login: "octocat",
    installation_account_type: "User",
    installation_connected_at: "2026-06-21T00:00:00.000Z",
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z"
  };

  it("reports missing contents permission from the installation token", async () => {
    mockedMintGitHubInstallationToken.mockResolvedValueOnce({
      token: "ghs_token",
      expiresAt: "2026-06-21T01:00:00.000Z",
      permissions: { issues: "write" },
      repositorySelection: "all",
      contentsPermission: null,
      canReadContents: false,
      canWriteContents: false
    });

    await expect(inspectWorkspaceGitHubAppInstallationAccess(appConfig)).resolves.toMatchObject({
      ok: true,
      repositorySelection: "all",
      contentsPermission: null,
      canReadContents: false,
      canWriteContents: false
    });
  });
});
