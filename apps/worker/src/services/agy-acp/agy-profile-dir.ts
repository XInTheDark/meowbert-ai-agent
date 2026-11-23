import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decryptAntigravitySecret,
  encryptAntigravitySecret,
  parseAntigravityTokenExpiry
} from "@meowbert/shared/antigravity-crypto";
import { config } from "../../lib/config.js";
import { query, withTransaction } from "../../lib/db.js";

const ANTIGRAVITY_CREDENTIALS_LOCK = 819205019;

const MCP_ONLY_AGENT_MARKDOWN = [
  "---",
  "name: mcp-only",
  "description: Runs tasks strictly through the Meowbert MCP bridge",
  "mainAgent: true",
  "subagent: false",
  "tools: [send_message]",
  "commandExecutionPolicy: off",
  "inheritMcp: true",
  "---",
  "Use only the configured meowbert-bridge MCP tools to perform the task.",
  "Do not attempt to access the local filesystem or run local commands."
].join("\n") + "\n";

const ISOLATED_SETTINGS_JSON = JSON.stringify({
  permissions: {
    deny: [
      "command(*)",
      "read_file(*)",
      "write_file(*)",
      "read_url(*)",
      "execute_url(*)"
    ]
  }
}, null, 2);

export interface HydratedAgyProfile {
  credentialId: string;
  revision: number;
  initialOauthTokenJson: string;
  rootDir: string;
  homeDir: string;
  cwdDir: string;
  logFilePath: string;
  tokenPath: string;
  cleanupAndSync: (update?: { tierName?: string | null; tierId?: string | null; lastError?: string | null }) => Promise<void>;
}

interface SelectedCredentialRow {
  id: string;
  oauth_token_encrypted: string;
  acp_auth_state_encrypted: string;
  revision: number;
}

export async function hydrateSelectedAgyProfile(options?: { taskId?: string }): Promise<HydratedAgyProfile> {
  const result = await query<SelectedCredentialRow>(
    `SELECT id, oauth_token_encrypted, acp_auth_state_encrypted, revision
       FROM antigravity_credentials
      WHERE is_selected = true
      LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("No Antigravity account is connected and selected. Connect a Google account in Admin -> Antigravity.");
  }
  return hydrateAgyProfileRow(row, options?.taskId);
}

export async function hydrateAgyProfileById(credentialId: string): Promise<HydratedAgyProfile> {
  const result = await query<SelectedCredentialRow>(
    `SELECT id, oauth_token_encrypted, acp_auth_state_encrypted, revision
       FROM antigravity_credentials
      WHERE id = $1`,
    [credentialId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("provider_missing");
  }
  return hydrateAgyProfileRow(row);
}

async function hydrateAgyProfileRow(row: SelectedCredentialRow, taskId?: string): Promise<HydratedAgyProfile> {
  const secret = config.security.jwtSecret;
  const oauthTokenJson = decryptAntigravitySecret(row.oauth_token_encrypted, secret);
  const acpAuthStateJson = decryptAntigravitySecret(row.acp_auth_state_encrypted, secret);

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-agy-run-"));
  await fs.chmod(rootDir, 0o700);
  const homeDir = path.join(rootDir, "home");
  const safeTaskId = taskId?.replace(/[^a-zA-Z0-9_-]/g, "");
  const cwdDir = safeTaskId
    ? path.join(os.tmpdir(), "meowbert-agy-cwd", safeTaskId)
    : path.join(rootDir, "cwd");
  const logFilePath = path.join(rootDir, "acp.log");
  const cliDir = path.join(homeDir, ".gemini", "antigravity-cli");
  const cacheDir = path.join(cliDir, "cache");
  const agentsDir = path.join(homeDir, ".gemini", "config", "agents");
  const tokenPath = path.join(cliDir, "antigravity-oauth-token");

  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(agentsDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(cwdDir, { recursive: true, mode: 0o700 });

  await Promise.all([
    fs.writeFile(tokenPath, oauthTokenJson, { mode: 0o600 }),
    fs.writeFile(path.join(cacheDir, "acp-auth-state.json"), acpAuthStateJson, { mode: 0o600 }),
    fs.writeFile(path.join(cliDir, "settings.json"), ISOLATED_SETTINGS_JSON, { mode: 0o600 }),
    fs.writeFile(path.join(agentsDir, "mcp-only.md"), MCP_ONLY_AGENT_MARKDOWN, { mode: 0o600 })
  ]);

  let cleanedUp = false;
  return {
    credentialId: row.id,
    revision: row.revision,
    initialOauthTokenJson: oauthTokenJson,
    rootDir,
    homeDir,
    cwdDir,
    logFilePath,
    tokenPath,
    async cleanupAndSync(update) {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        const latestTokenJson = await fs.readFile(tokenPath, "utf8").catch(() => null);
        await syncCredentialMetadata({
          credentialId: row.id,
          expectedRevision: row.revision,
          initialOauthTokenJson: oauthTokenJson,
          latestOauthTokenJson: latestTokenJson,
          tierName: update?.tierName ?? null,
          tierId: update?.tierId ?? null,
          lastError: update?.lastError ?? null
        });
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  };
}

async function syncCredentialMetadata(input: {
  credentialId: string;
  expectedRevision: number;
  initialOauthTokenJson: string;
  latestOauthTokenJson: string | null;
  tierName: string | null;
  tierId: string | null;
  lastError: string | null;
}): Promise<void> {
  const tokenChanged = Boolean(
    input.latestOauthTokenJson
    && input.latestOauthTokenJson !== input.initialOauthTokenJson
  );
  const newExpiry = tokenChanged && input.latestOauthTokenJson
    ? parseAntigravityTokenExpiry(input.latestOauthTokenJson)
    : null;
  const oldExpiry = parseAntigravityTokenExpiry(input.initialOauthTokenJson);
  const hasNewerExpiry = Boolean(
    tokenChanged
    && newExpiry
    && (!oldExpiry || Date.parse(newExpiry) > Date.parse(oldExpiry))
  );

  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ANTIGRAVITY_CREDENTIALS_LOCK]);
    if (hasNewerExpiry && input.latestOauthTokenJson) {
      const encrypted = encryptAntigravitySecret(input.latestOauthTokenJson, config.security.jwtSecret);
      await client.query(
        `UPDATE antigravity_credentials
            SET oauth_token_encrypted = $2,
                token_expiry = $3,
                revision = revision + 1,
                tier_name = COALESCE($4, tier_name),
                tier_id = COALESCE($5, tier_id),
                last_error = $6,
                last_used_at = now(),
                updated_at = now()
          WHERE id = $1
            AND revision = $7
            AND (token_expiry IS NULL OR token_expiry < $3)`,
        [
          input.credentialId,
          encrypted,
          newExpiry,
          input.tierName,
          input.tierId,
          input.lastError,
          input.expectedRevision
        ]
      );
      return;
    }

    await client.query(
      `UPDATE antigravity_credentials
          SET tier_name = COALESCE($2, tier_name),
              tier_id = COALESCE($3, tier_id),
              last_error = $4,
              last_used_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [input.credentialId, input.tierName, input.tierId, input.lastError]
    );
  }).catch((error) => {
    console.warn("[agy-acp] Failed to sync Antigravity credential metadata", {
      credentialId: input.credentialId,
      error: error instanceof Error ? error.message : String(error)
    });
  });
}
