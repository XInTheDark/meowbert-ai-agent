import type { BridgeHandoffInfo, BridgeServerStatus, BridgeToolMode } from "@meowbert/shared";
import { readBridgeSettings, regenerateBridgeBearerToken, saveBridgeSettings } from "../state";
import { BridgeMcpServer } from "./bridge-mcp-server";
import { BridgeRegistry } from "./bridge-registry";

export const bridgeRegistry = new BridgeRegistry();

let serverInstance: BridgeMcpServer | null = null;
let startPromise: Promise<BridgeServerStatus> | null = null;

export async function ensureBridgeServerStarted(): Promise<BridgeServerStatus> {
  if (serverInstance?.getStatus().running) {
    return serverInstance.getStatus();
  }
  if (startPromise) {
    return startPromise;
  }
  startPromise = (async () => {
    const settings = await readBridgeSettings();
    if (!serverInstance) {
      serverInstance = new BridgeMcpServer({
        registry: bridgeRegistry,
        bearerToken: settings.bearerToken,
        toolMode: settings.toolMode,
        preferredPort: settings.preferredPort
      });
    } else {
      serverInstance.reconfigure({
        bearerToken: settings.bearerToken,
        toolMode: settings.toolMode
      });
    }
    return serverInstance.start();
  })().finally(() => {
    startPromise = null;
  });
  return startPromise;
}

export async function getBridgeServerStatus(): Promise<BridgeServerStatus> {
  try {
    return await ensureBridgeServerStarted();
  } catch (error) {
    const settings = await readBridgeSettings();
    return {
      running: false,
      endpointUrl: null,
      port: null,
      bearerToken: settings.bearerToken,
      toolMode: settings.toolMode,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function regenerateBridgeToken(): Promise<BridgeServerStatus> {
  const settings = await regenerateBridgeBearerToken();
  if (serverInstance) {
    return serverInstance.reconfigure({ bearerToken: settings.bearerToken });
  }
  return getBridgeServerStatus();
}

export async function setBridgeToolMode(toolMode: BridgeToolMode): Promise<BridgeServerStatus> {
  const settings = await saveBridgeSettings({ toolMode });
  if (serverInstance) {
    return serverInstance.reconfigure({ toolMode: settings.toolMode });
  }
  return getBridgeServerStatus();
}

export function listActiveBridgeSessions(): BridgeHandoffInfo[] {
  return bridgeRegistry.listActive();
}

export function getTaskBridgeHandoff(taskId: string): BridgeHandoffInfo | null {
  return bridgeRegistry.getByTaskId(taskId);
}

export function parkBridgeRun(runId: string): boolean {
  return bridgeRegistry.parkRun(runId);
}

export function onBridgeSessionsChanged(listener: (sessions: BridgeHandoffInfo[]) => void): () => void {
  return bridgeRegistry.onChange(listener);
}

export async function stopBridgeServer(): Promise<void> {
  const current = serverInstance;
  serverInstance = null;
  if (current) {
    await current.stop();
  }
}
