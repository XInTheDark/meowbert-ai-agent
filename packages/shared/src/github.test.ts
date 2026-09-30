import { describe, expect, it } from "vitest";
import {
  buildGitHubRuntimeEnv,
  normalizeGitHubAppPrivateKeyPem,
  summarizeGitHubInstallationAccess
} from "./github.js";

describe("buildGitHubRuntimeEnv", () => {
  it("returns empty env map when credentials are missing", () => {
    expect(buildGitHubRuntimeEnv(null)).toEqual({});
    expect(
      buildGitHubRuntimeEnv({
        accessToken: "",
        login: ""
      })
    ).toEqual({});
  });

  it("builds gh/git environment values from linked account credentials", () => {
    const env = buildGitHubRuntimeEnv({
      accessToken: "gho_exampletoken",
      login: "octocat",
      name: "The Octocat",
      email: "octocat@github.com",
      defaultOrg: "my-org"
    });

    expect(env.GH_TOKEN).toBe("gho_exampletoken");
    expect(env.GITHUB_TOKEN).toBe("gho_exampletoken");
    expect(env.GH_PROMPT_DISABLED).toBe("1");
    expect(env.GIT_AUTHOR_NAME).toBe("The Octocat");
    expect(env.GIT_COMMITTER_EMAIL).toBe("octocat@github.com");
    expect(env.MEOWBERT_GITHUB_DEFAULT_ORG).toBe("my-org");
    expect(env.GIT_CONFIG_KEY_0).toContain("url.https://x-access-token:gho_exampletoken@github.com/.insteadOf");
    expect(env.GIT_CONFIG_VALUE_0).toBe("https://github.com/");
  });

  it("includes GitHub App repository access metadata when available", () => {
    const env = buildGitHubRuntimeEnv({
      accessToken: "ghs_exampletoken",
      login: "meowbert-app",
      contentsPermission: "write",
      repositorySelection: "all"
    });

    expect(env.MEOWBERT_GITHUB_CONTENTS_PERMISSION).toBe("write");
    expect(env.MEOWBERT_GITHUB_REPOSITORY_SELECTION).toBe("all");
  });

  it("falls back to login and noreply email when profile fields are unavailable", () => {
    const env = buildGitHubRuntimeEnv({
      accessToken: "gho_exampletoken",
      login: "octocat"
    });

    expect(env.GIT_AUTHOR_NAME).toBe("octocat");
    expect(env.GIT_AUTHOR_EMAIL).toBe("octocat@users.noreply.github.com");
    expect(env.MEOWBERT_GITHUB_DEFAULT_ORG).toBeUndefined();
  });
});

describe("summarizeGitHubInstallationAccess", () => {
  it("detects readable and writable contents permissions", () => {
    expect(
      summarizeGitHubInstallationAccess({
        permissions: { contents: "write", issues: "read" },
        repositorySelection: "all"
      })
    ).toMatchObject({
      repositorySelection: "all",
      contentsPermission: "write",
      canReadContents: true,
      canWriteContents: true
    });

    expect(
      summarizeGitHubInstallationAccess({
        permissions: { issues: "write" },
        repositorySelection: "selected"
      })
    ).toMatchObject({
      repositorySelection: "selected",
      contentsPermission: null,
      canReadContents: false,
      canWriteContents: false
    });
  });
});

describe("normalizeGitHubAppPrivateKeyPem", () => {
  it("normalizes escaped and JSON-wrapped PEM strings", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "abc",
      "-----END RSA PRIVATE KEY-----"
    ].join("\n");

    expect(normalizeGitHubAppPrivateKeyPem(pem.replace(/\n/g, "\\n"))).toBe(pem);
    expect(normalizeGitHubAppPrivateKeyPem(JSON.stringify(pem))).toBe(pem);
    expect(normalizeGitHubAppPrivateKeyPem(pem.replace(/\n/g, "\r\n"))).toBe(pem);
  });
});
