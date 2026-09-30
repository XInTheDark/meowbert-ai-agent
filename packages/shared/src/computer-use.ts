export const DESKTOP_COMPUTER_REQUEST_CHANNEL = "desktop-computer:request";
export const DESKTOP_COMPUTER_PRESENCE_TTL_SECONDS = 30;

export const COMPUTER_TOOL_NAMES = [
  "computer_screenshot",
  "computer_cursor_position",
  "computer_mouse_move",
  "computer_left_click",
  "computer_left_click_drag",
  "computer_right_click",
  "computer_middle_click",
  "computer_double_click",
  "computer_triple_click",
  "computer_scroll",
  "computer_type",
  "computer_key",
  "computer_hold_key",
  "computer_left_mouse_down",
  "computer_left_mouse_up",
  "computer_wait",
  "computer_local_shell"
] as const;

export type ComputerToolName = (typeof COMPUTER_TOOL_NAMES)[number];

export type DesktopComputerPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported"
  | "unknown";

export interface DesktopComputerPermissions {
  accessibility: DesktopComputerPermissionState;
  screenRecording: DesktopComputerPermissionState;
}

export interface DesktopComputerDisplay {
  id: string;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  coordinateSpaceWidth: number;
  coordinateSpaceHeight: number;
}

export interface DesktopComputerCursorPosition {
  x: number;
  y: number;
}

export interface DesktopComputerStatus {
  available: boolean;
  platform: string;
  permissions: DesktopComputerPermissions;
  display: DesktopComputerDisplay | null;
  cursor: DesktopComputerCursorPosition | null;
  canTakeScreenshot: boolean;
  canControlComputer: boolean;
  requiresRestart: boolean;
  reason: string | null;
}

export interface DesktopComputerObservation {
  text: string;
  imageDataUrl: string;
  display: DesktopComputerDisplay;
  cursor: DesktopComputerCursorPosition | null;
}

export interface DesktopComputerExecutorHello {
  type: "hello" | "heartbeat";
  sessionId: string;
  status: DesktopComputerStatus;
  sentAt: string;
}

export interface DesktopComputerExecutorRequest {
  type: "computer_action";
  requestId: string;
  taskId: string;
  toolName: ComputerToolName;
  args: Record<string, unknown>;
  issuedAt: string;
}

export interface DesktopComputerExecutorResult {
  type: "computer_action_result";
  requestId: string;
  taskId: string;
  toolName: ComputerToolName;
  ok: boolean;
  output?: Record<string, unknown>;
  observation?: DesktopComputerObservation | null;
  error?: string | null;
  completedAt: string;
}

export interface DesktopComputerExecutorError {
  type: "error";
  message: string;
}

export type DesktopComputerExecutorClientMessage =
  | DesktopComputerExecutorHello
  | DesktopComputerExecutorResult;

export type DesktopComputerExecutorServerMessage =
  | DesktopComputerExecutorRequest
  | DesktopComputerExecutorError;

export function buildDesktopComputerPresenceKey(userId: string): string {
  return `desktop-computer:presence:${userId}`;
}

export function buildDesktopComputerResponseChannel(requestId: string): string {
  return `desktop-computer:response:${requestId}`;
}

export function isComputerToolName(value: string): value is ComputerToolName {
  return (COMPUTER_TOOL_NAMES as readonly string[]).includes(value);
}

export function isVisualComputerToolName(value: ComputerToolName): boolean {
  return value !== "computer_local_shell";
}
