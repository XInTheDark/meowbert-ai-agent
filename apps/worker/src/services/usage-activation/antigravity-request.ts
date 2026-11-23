import { AcpJsonRpcClient } from "../agy-acp/acp-jsonrpc-client.js";
import { extractAgyTierMeta, matchConfigOptionValue } from "../agy-acp/agy-acp-protocol.js";
import { hydrateAgyProfileById } from "../agy-acp/agy-profile-dir.js";

const ACTIVATION_TIMEOUT_MS = 45_000;

async function pingSingleAntigravityAccount(credentialId: string, model: string): Promise<void> {
  const profile = await hydrateAgyProfileById(credentialId);
  let client: AcpJsonRpcClient | null = null;
  let sessionId: string | null = null;
  let tierName: string | null = null;
  let tierId: string | null = null;
  let lastError: string | null = null;

  try {
    client = new AcpJsonRpcClient({
      command: process.env.MEOWBERT_AGY_BIN?.trim() || "agy",
      args: [
        "acp",
        "--process-per-session",
        "--agent", "mcp-only",
        "--include-default-customizations=false",
        "--dangerously-skip-permissions",
        "--disable-telemetry",
        "--log-file", profile.logFilePath
      ],
      cwd: profile.cwdDir,
      env: { ...process.env, HOME: profile.homeDir, AGY_CLI_DISABLE_AUTO_UPDATE: "true" }
    });

    await client.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "meowbert", version: "1.0.0" },
      clientCapabilities: {}
    }, ACTIVATION_TIMEOUT_MS);

    const created = await client.request<Record<string, unknown>>("session/new", {
      cwd: profile.cwdDir,
      mcpServers: []
    }, ACTIVATION_TIMEOUT_MS);
    sessionId = typeof created.sessionId === "string" ? created.sessionId : null;
    if (!sessionId) throw new Error("missing_result");

    const tier = extractAgyTierMeta(created);
    tierName = tier.tierName;
    tierId = tier.tierId;

    const matchedModel = matchConfigOptionValue(created.configOptions, "model", model) ?? model;
    if (matchedModel) {
      await client.request("session/set_config_option", {
        sessionId,
        configId: "model",
        value: matchedModel
      }, ACTIVATION_TIMEOUT_MS);
    }

    await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Reply with OK." }]
    }, ACTIVATION_TIMEOUT_MS);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (client) {
      await client.closeGracefully(sessionId).catch(() => undefined);
    }
    await profile.cleanupAndSync({ tierName, tierId, lastError });
  }
}

export async function sendAntigravityActivationRequest(credentialIds: string[], model: string): Promise<void> {
  if (credentialIds.length === 0) throw new Error("provider_missing");
  const results = await Promise.allSettled(
    credentialIds.map((credentialId) => pingSingleAntigravityAccount(credentialId, model))
  );
  const failed = results.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`antigravity_partial_failure:${failed.length}/${credentialIds.length}`);
  }
}
