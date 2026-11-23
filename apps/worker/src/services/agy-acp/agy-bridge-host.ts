import { randomBytes } from "node:crypto";
import {
  BridgeMcpServer,
  BridgeRegistry,
  listBridgeMcpTools
} from "@meowbert/run-executor/bridge/index";

export const AGY_BRIDGE_MCP_SERVER_NAME = "meowbert-bridge";

export type BridgeToolActivityListener = (toolName: string, phase: "start" | "end") => void;

export interface WorkerBridgeHost {
  registry: BridgeRegistry;
  endpointUrl: string;
  bearerToken: string;
  onSessionToolActivity: (sessionCode: string, listener: BridgeToolActivityListener) => () => void;
}

const registry = new BridgeRegistry();
const activityListeners = new Map<string, Set<BridgeToolActivityListener>>();

let server: BridgeMcpServer | null = null;
let startPromise: Promise<WorkerBridgeHost> | null = null;
let cachedToken: string | null = null;

function notifyToolActivity(sessionCode: string, toolName: string, phase: "start" | "end"): void {
  const listeners = activityListeners.get(sessionCode);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(toolName, phase);
  }
}

export function getAllowedAgyBridgeToolNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const spec of listBridgeMcpTools("standard")) {
    names.add(`mcp_${AGY_BRIDGE_MCP_SERVER_NAME}_${spec.mcpName}`);
  }
  return names;
}

export async function ensureWorkerBridgeHost(): Promise<WorkerBridgeHost> {
  const status = server?.getStatus();
  if (status?.running && status.endpointUrl && cachedToken) {
    return buildHandle(status.endpointUrl, cachedToken);
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const bearerToken = cachedToken ?? randomBytes(32).toString("hex");
    cachedToken = bearerToken;
    if (!server) {
      server = new BridgeMcpServer({
        registry,
        bearerToken,
        toolMode: "standard",
        preferredPort: 0,
        onToolActivity: notifyToolActivity
      });
    }
    const started = await server.start();
    if (!started.running || !started.endpointUrl) {
      throw new Error("Failed to start worker-local Bridge MCP server.");
    }
    return buildHandle(started.endpointUrl, bearerToken);
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}

function buildHandle(endpointUrl: string, bearerToken: string): WorkerBridgeHost {
  return {
    registry,
    endpointUrl,
    bearerToken,
    onSessionToolActivity(sessionCode, listener) {
      let set = activityListeners.get(sessionCode);
      if (!set) {
        set = new Set();
        activityListeners.set(sessionCode, set);
      }
      set.add(listener);
      return () => {
        const current = activityListeners.get(sessionCode);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) activityListeners.delete(sessionCode);
      };
    }
  };
}

export async function stopWorkerBridgeHost(): Promise<void> {
  const current = server;
  server = null;
  cachedToken = null;
  activityListeners.clear();
  if (current) {
    await current.stop();
  }
}
