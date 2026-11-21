import type { LocalExecutionMode } from "./task-execution-target.js";

export type BridgeSessionStatus =
  | "waiting_for_start"
  | "connected"
  | "completed"
  | "parked"
  | "cancelled";

export type BridgeToolMode = "standard" | "compact";

export const BRIDGE_CONNECT_TIMEOUT_MS = 15 * 60 * 1_000;
export const BRIDGE_IDLE_TIMEOUT_MS = 15 * 60 * 1_000;
export const BRIDGE_MAX_RUN_SHELL_TIMEOUT_SECONDS = 45;

export interface BridgeServerStatus {
  running: boolean;
  endpointUrl: string | null;
  port: number | null;
  bearerToken: string;
  toolMode: BridgeToolMode;
  error?: string | null;
}

export interface BridgeHandoffInfo {
  runId: string;
  taskId: string;
  sessionCode: string;
  mode: LocalExecutionMode;
  status: BridgeSessionStatus;
  prompt: string;
  createdAt: string;
  connectedAt: string | null;
  lastActivityAt: string | null;
}

export function buildBridgeHandoffPrompt(sessionCode: string): string {
  return [
    `Call \`meowbert_start\` with \`session_code: "${sessionCode}"\` and complete the task strictly through Meowbert's MCP tools.`,
    "Do not use your built-in file, shell, or web tools; finish by calling `meowbert_final_response` (or `meowbert_wait`)."
  ].join("\n");
}
