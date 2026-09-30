export function buildGitHubAppConfigDraft(defaultOrg: string | null): string {
  const privateKeyPemExample = [
    "-----BEGIN PRIVATE KEY-----",
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDexample...",
    "-----END PRIVATE KEY-----",
    ""
  ].join("\\n");

  return JSON.stringify(
    {
      appId: 123456,
      appSlug: "my-workspace-bot",
      privateKeyPem: privateKeyPemExample,
      webhookSecret: "replace-with-webhook-secret",
      clientId: null,
      clientSecret: null,
      defaultOrg: defaultOrg ?? "my-org"
    },
    null,
    2
  );
}
