import { z } from "zod";

/** The two places a task may execute. Cloud remains the default for old rows and clients. */
export const taskExecutionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cloud") }).strict(),
  z.object({
    kind: z.literal("local"),
    deviceId: z.string().uuid(),
    mode: z.literal("sandbox")
  }).strict()
]);

export type TaskExecutionTarget = z.infer<typeof taskExecutionTargetSchema>;

export const TASK_EXECUTION_TARGET_KINDS = ["cloud", "local"] as const;
export const LOCAL_EXECUTION_MODES = ["sandbox"] as const;

export type LocalExecutionMode = (typeof LOCAL_EXECUTION_MODES)[number];

export type LocalPendingReason =
  | "device_offline"
  | "storage_unavailable"
  | "docker_unavailable"
  | "sandbox_missing"
  | "sandbox_downloading"
  | "sandbox_updating"
  | "executor_outdated"
  | "device_busy"
  | "claim_timeout"
  | "waiting_for_storage"
  | "local_execution_disabled"
  | "cancelled";

export const LOCAL_PENDING_REASONS: readonly LocalPendingReason[] = [
  "device_offline",
  "storage_unavailable",
  "docker_unavailable",
  "sandbox_missing",
  "sandbox_downloading",
  "sandbox_updating",
  "executor_outdated",
  "device_busy",
  "claim_timeout",
  "waiting_for_storage",
  "local_execution_disabled",
  "cancelled"
];

export const DEFAULT_LOCAL_DEVICE_CAPACITY = 2;

export function isSupportedLocalExecutor(platform: string, architecture: string): boolean {
  return (platform === "darwin" && architecture === "arm64")
    || (platform === "win32" && (architecture === "x64" || architecture === "arm64"));
}
export const DEVICE_HEARTBEAT_INTERVAL_MS = 10_000;
export const DEVICE_READY_WINDOW_MS = 30_000;
export const LOCAL_RUN_CLAIM_WINDOW_MS = 60_000;
export const LOCAL_RUN_MAX_PENDING_MS = 24 * 60 * 60 * 1_000;

export function isLocalTaskExecutionTarget(value: TaskExecutionTarget): value is Extract<TaskExecutionTarget, { kind: "local" }> {
  return value.kind === "local";
}

export function normalizeTaskExecutionTarget(value: unknown): TaskExecutionTarget {
  const parsed = taskExecutionTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : { kind: "cloud" };
}

export function assertLocalTaskExecutionTarget(value: unknown): Extract<TaskExecutionTarget, { kind: "local" }> {
  const parsed = taskExecutionTargetSchema.parse(value);
  if (parsed.kind !== "local") {
    throw new Error("A local execution target is required.");
  }
  return parsed;
}

export interface DeviceReadiness {
  connected: boolean;
  storageVerified: boolean;
  dockerReady: boolean;
  sandboxImageReady: boolean;
  executorSupported: boolean;
  capacityAvailable: boolean;
}

export function isDeviceReadyForSandbox(readiness: DeviceReadiness): boolean {
  return readiness.connected
    && readiness.storageVerified
    && readiness.dockerReady
    && readiness.sandboxImageReady
    && readiness.executorSupported
    && readiness.capacityAvailable;
}
