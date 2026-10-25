import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { createConnection } from "@playwright/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpConnection } from "@meowbert/run-executor/agent/mcp-client";
import { DeviceTaskLock } from "../device-task-lock";

/** One headed profile per desktop. Each run gets a scoped MCP connection. */
export function createHostBrowserService(userData: string) {
  let context: BrowserContext | null = null;
  let opening: Promise<BrowserContext> | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  const lock = new DeviceTaskLock("The browser", 300_000, () => { void close(); });
  const close = () => {
    const work = pending.then(async () => {
      const current = context ?? await opening?.catch(() => null); context = null;
      await current?.close();
    });
    pending = work.catch(() => undefined);
    return work;
  };
  const open = async (): Promise<BrowserContext> => {
    await pending;
    if (context) return context;
    opening ??= (async () => {
      const profile = path.join(userData, "browser-profile");
      try { return await chromium.launchPersistentContext(profile, { channel: "chrome", headless: false }); }
      catch (error) {
        if (!(error instanceof Error) || !/not found|doesn.t exist|distribution/i.test(error.message)) throw error;
        return chromium.launchPersistentContext(profile, { channel: "msedge", headless: false });
      }
    })();
    try {
      context = await opening;
      context.on("close", () => { context = null; });
      return context;
    } finally { opening = null; }
  };
  const connect = async (taskId: string, signal: AbortSignal): Promise<McpConnection> => {
    const server = await createConnection({ browser: { browserName: "chromium" } }, () => {
      signal.throwIfAborted();
      lock.acquire(taskId);
      return open();
    });
    const client = new Client({ name: "meowbert-desktop", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = client.callTool.bind(client);
    client.callTool = (...args) => lock.use(taskId, async () => { signal.throwIfAborted(); return call(...args); });
    signal.addEventListener("abort", () => { lock.release(taskId); void client.close(); }, { once: true });
    if (signal.aborted) { await client.close(); throw new Error("The local run has been fenced."); }
    return { client, transport: clientTransport, skillId: "host-browser", requestTimeoutMs: 60_000 };
  };
  return { connect, release: async (taskId: string) => { lock.release(taskId); await pending; }, close };
}
