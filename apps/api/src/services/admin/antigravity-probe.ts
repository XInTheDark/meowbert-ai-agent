import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AntigravityConfigOptionChoice,
  AntigravityCredentialModelsResult,
  AntigravityCredentialUsageResult,
  AntigravityUsageGroup
} from "@meowbert/shared";
import {
  loadDecryptedAntigravityCredential,
  updateAntigravityCredentialTier
} from "./antigravity-credentials.js";

const PROBE_TIMEOUT_MS = 25_000;

function resolveAgyBinary(): string {
  return process.env.MEOWBERT_AGY_BIN?.trim() || "agy";
}

async function withHydratedProfile<T>(credentialId: string, fn: (homeDir: string, cwdDir: string) => Promise<T>): Promise<T> {
  const credential = await loadDecryptedAntigravityCredential(credentialId);
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-agy-probe-"));
  const homeDir = path.join(rootDir, "home");
  const cwdDir = path.join(rootDir, "cwd");
  const cliDir = path.join(homeDir, ".gemini", "antigravity-cli");
  const cacheDir = path.join(cliDir, "cache");
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(cwdDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(cliDir, "antigravity-oauth-token"), credential.oauthTokenJson, { mode: 0o600 });
  await fs.writeFile(path.join(cacheDir, "acp-auth-state.json"), credential.acpAuthStateJson, { mode: 0o600 });
  try {
    return await fn(homeDir, cwdDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseConfigChoices(configOptions: unknown, configId: string): AntigravityConfigOptionChoice[] {
  if (!Array.isArray(configOptions)) return [];
  const target = configOptions.find(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === configId
  );
  const rawOptions = Array.isArray(target?.options) ? target.options : [];
  const choices: AntigravityConfigOptionChoice[] = [];
  for (const option of rawOptions) {
    if (typeof option !== "object" || option === null) continue;
    const record = option as Record<string, unknown>;
    if (typeof record.value !== "string" || !record.value.trim()) continue;
    choices.push({
      value: record.value,
      label: typeof record.name === "string" && record.name.trim() ? record.name : record.value,
      ...(typeof record.description === "string" ? { description: record.description } : {})
    });
  }
  return choices;
}

export async function probeAntigravityCredentialModels(credentialId: string): Promise<AntigravityCredentialModelsResult> {
  return withHydratedProfile(credentialId, (homeDir, cwdDir) => new Promise((resolve, reject) => {
    const child = spawn(resolveAgyBinary(), ["acp", "--process-per-session", "--disable-telemetry"], {
      cwd: cwdDir,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: homeDir, AGY_CLI_DISABLE_AUTO_UPDATE: "true" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (err?: Error, value?: AntigravityCredentialModelsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* ignore */ }
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error("Timed out querying Antigravity models.")), PROBE_TIMEOUT_MS);

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line) as Record<string, unknown>; } catch { return; }
      if (msg.id === 1) {
        if (msg.error) return finish(new Error(`ACP initialize failed: ${JSON.stringify(msg.error)}`));
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: cwdDir, mcpServers: [] } })}\n`);
      } else if (msg.id === 2) {
        if (msg.error) return finish(new Error(`ACP session/new failed: ${JSON.stringify(msg.error)}`));
        const result = (msg.result ?? {}) as Record<string, unknown>;
        const sessionId = typeof result.sessionId === "string" ? result.sessionId : null;
        if (sessionId) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/close", params: { sessionId } })}\n`);
        }
        const meta = (result._meta as { antigravity?: { tier?: { name?: unknown; id?: unknown } } } | undefined)?.antigravity?.tier;
        const tierName = typeof meta?.name === "string" ? meta.name : null;
        const tierId = typeof meta?.id === "string" ? meta.id : null;
        void updateAntigravityCredentialTier(credentialId, tierName, tierId).catch(() => undefined);
        finish(undefined, {
          models: parseConfigChoices(result.configOptions, "model"),
          thinkingLevels: parseConfigChoices(result.configOptions, "thought_level"),
          tierName,
          tierId
        });
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (!settled) finish(new Error(`Antigravity exited before returning models (code ${code ?? "unknown"}): ${stderr.slice(0, 300)}`));
    });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1, clientInfo: { name: "meowbert", version: "1.0.0" }, clientCapabilities: {} }
    })}\n`);
  }));
}

export async function probeAntigravityCredentialUsage(credentialId: string): Promise<AntigravityCredentialUsageResult> {
  return withHydratedProfile(credentialId, (homeDir, cwdDir) => new Promise((resolve, reject) => {
    const child = spawn(resolveAgyBinary(), ["-p", "/usage", "--output-format", "json"], {
      cwd: cwdDir,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: homeDir, AGY_CLI_DISABLE_AUTO_UPDATE: "true" }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      reject(new Error("Timed out querying Antigravity usage."));
    }, PROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Antigravity usage command failed (code ${code ?? "unknown"}): ${stderr.slice(0, 300)}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
        const rawGroups = ((parsed.command as { data?: { groups?: unknown } } | undefined)?.data?.groups);
        const groups: AntigravityUsageGroup[] = Array.isArray(rawGroups)
          ? rawGroups
            .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
            .map((entry, idx) => ({
              name: typeof entry.name === "string" && entry.name.trim() ? entry.name : `Group ${idx + 1}`,
              raw: entry
            }))
          : [];
        resolve({ groups, raw: parsed });
      } catch (error) {
        reject(new Error(`Failed to parse Antigravity usage output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }));
}
