import fs from "node:fs/promises";
import path from "node:path";
import type { FunctionTool } from "openai/resources/responses/responses";
import { isSkillEnabledByConfig, isSourceManifest } from "@meowbert/shared";
import { loadSkillManifests, type SkillEntry } from "@meowbert/run-executor/agent/skill-registry";
import { listMcpTools, mcpToolsToFunctionTools, skillToolPrefix, startMcpServer, stopMcpServer } from "@meowbert/run-executor/agent/mcp-client";
import type { RunControl } from "@meowbert/run-executor/agent/ports/run-control";
import { config } from "../../lib/config.js";
import { workerSandboxManager } from "../runtime/sandbox.js";
import type { ServerRunState } from "../run-host/bootstrap.js";
import type { DeviceToolConsent } from "./builtin-tool-policy.js";
import { resolveRunToolOptions } from "@meowbert/run-executor/agent/runtime";
import { RunApiFailure } from "./failure.js";

async function hostBrowserTools(): Promise<FunctionTool[]> {
  const [{ createConnection }, { Client }, { InMemoryTransport }] = await Promise.all([
    import("@playwright/mcp"), import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/inMemory.js")
  ]);
  const server = await createConnection({ browser: { browserName: "chromium" } }, () => { throw new Error("Catalog lookup cannot open a browser."); });
  const client = new Client({ name: "meowbert-tool-policy", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const tools = await client.listTools();
    return mcpToolsToFunctionTools("host-browser", tools.tools.map((tool) => ({ name: tool.name,
      description: tool.description ?? "", inputSchema: tool.inputSchema })));
  } finally { await client.close(); await server.close(); }
}

// Resolve schemas from trusted installed MCP servers, never from a desktop's claimed catalog.
// Discovery mounts only skill assets and app-owned scratch, with no workspace files.
export function createSkillToolPolicy(state: ServerRunState, control: RunControl, consent: DeviceToolConsent) {
  const cache = new Map<string, Promise<FunctionTool[]>>();
  let entries: ReturnType<typeof loadSkillManifests> | undefined;
  return async (name: string): Promise<FunctionTool[]> => {
    const root = config.skills?.rootDir;
    if (!root) throw new RunApiFailure("invalid_request", "Skills are unavailable for this run.");
    entries ??= loadSkillManifests(root);
    const entry = [...entries.values()].find((item) => name.startsWith(skillToolPrefix(item.manifest.id)));
    if (!entry) throw new RunApiFailure("invalid_request", "Unknown model tool.");
    const { manifest } = entry;
    const local = state.job.executionTarget?.kind === "local";
    const host = local && state.job.executionTarget?.kind === "local" && state.job.executionTarget.mode === "host";
    const options = resolveRunToolOptions(state.snapshot, state.job, state.bootstrap.memoryEnabled);
    if (!isSkillEnabledByConfig(config, manifest.id) || (manifest.requiresSuperAdmin && !state.bootstrap.runActorIsSuperAdmin)
      || (host && manifest.host !== "supported") || (isSourceManifest(manifest) && !options.enabledSources.includes(manifest.id))
      || (manifest.id === "host-browser" && (!local || !consent.hostBrowser))) {
      throw new RunApiFailure("invalid_request", "This skill is unavailable for this run.");
    }
    let pending = cache.get(manifest.id);
    if (!pending) {
      pending = manifest.id === "host-browser" ? hostBrowserTools() : resolveSkillTools(state, control, entry, entries);
      cache.set(manifest.id, pending);
      void pending.catch(() => cache.delete(manifest.id));
    }
    try { return await pending; }
    catch { throw new RunApiFailure("invalid_request", "The trusted skill tool catalog is unavailable for this run."); }
  };
}

async function resolveSkillTools(state: ServerRunState, control: RunControl, entry: SkillEntry, entries: Map<string, SkillEntry>): Promise<FunctionTool[]> {
  await fs.mkdir(config.runtime.taskScratch.root, { recursive: true });
  const scratch = await fs.mkdtemp(path.join(config.runtime.taskScratch.root, "tool-catalog-"));
  let sandbox: Awaited<ReturnType<typeof workerSandboxManager.createPersistentSandbox>> | null = null;
  let connection: Awaited<ReturnType<typeof startMcpServer>> | null = null;
  try {
    sandbox = await workerSandboxManager.createPersistentSandbox({ workingDir: scratch, networkEnabled: entry.manifest.mcp.transport === "sse", runAsRoot: false,
      mounts: [{ path: scratch }, { path: config.skills!.rootDir, readOnly: true }], labels: { purpose: "shell-exec" },
      resources: { cpus: 1, memoryMb: 1024, pids: 128 } });
    const sourceId = isSourceManifest(entry.manifest) ? entry.manifest.id : entry.manifest.sourceAccess?.sourceId;
    const source = sourceId ? entries.get(sourceId)?.manifest.source : null;
    const env = { MEOWBERT_TASK_DIR: scratch, MEOWBERT_WORKSPACE_ROOT: scratch,
      GOOGLE_WORKSPACE_REFERENCES_JSON: "[]",
      ...(sourceId && source?.provider ? await control.platform.issueSourceAccess({ sourceId, provider: source.provider,
        ticketScope: entry.manifest.sourceAccess ? "source_reference_proxy" : "source_proxy" }) : {}) };
    connection = await startMcpServer(entry.manifest, entry.skillDir, sandbox, 15_000, env);
    return mcpToolsToFunctionTools(entry.manifest.id, await listMcpTools(connection));
  } finally {
    try { if (connection) await stopMcpServer(connection); } finally {
      try { await sandbox?.stop(); } finally { await fs.rm(scratch, { recursive: true, force: true }); }
    }
  }
}
