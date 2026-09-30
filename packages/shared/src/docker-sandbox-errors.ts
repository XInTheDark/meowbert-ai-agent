import Docker from "dockerode";
import type { SandboxConfig } from "./sandbox.js";

type SandboxPurpose = "task-run" | "shell-session" | "shell-exec";

interface ManagedSandboxContainerSummaryLike {
  containerId: string;
  image: string;
  state: string;
  status: string;
  createdAt: string | null;
  purpose: SandboxPurpose | null;
  workspaceId: string | null;
  environmentId: string | null;
  taskId: string | null;
  runId: string | null;
  sessionId: string | null;
  parentContainerId: string | null;
}

export const SANDBOX_LABEL_KEY = "com.meowbert.sandbox";
export const SANDBOX_PURPOSE_LABEL_KEY = "com.meowbert.sandbox.purpose";
export const SANDBOX_WORKSPACE_ID_LABEL_KEY = "com.meowbert.workspace_id";
export const SANDBOX_ENVIRONMENT_ID_LABEL_KEY = "com.meowbert.environment_id";
export const SANDBOX_TASK_ID_LABEL_KEY = "com.meowbert.task_id";
export const SANDBOX_RUN_ID_LABEL_KEY = "com.meowbert.run_id";
export const SANDBOX_SESSION_ID_LABEL_KEY = "com.meowbert.session_id";
export const SANDBOX_PARENT_CONTAINER_ID_LABEL_KEY = "com.meowbert.parent_container_id";

interface DockerErrorLike {
  statusCode?: unknown;
  reason?: unknown;
  message?: unknown;
  json?: {
    message?: unknown;
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeContainerLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSandboxPurpose(value: unknown): SandboxPurpose | null {
  if (value === "task-run" || value === "shell-session" || value === "shell-exec") {
    return value;
  }

  return null;
}

function getDockerErrorText(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const dockerError = error as DockerErrorLike;
  return [
    typeof dockerError.reason === "string" ? dockerError.reason : "",
    typeof dockerError.message === "string" ? dockerError.message : "",
    typeof dockerError.json?.message === "string" ? dockerError.json.message : ""
  ]
    .filter((value) => value.length > 0)
    .join(" ")
    .toLowerCase();
}

export function isDockerImageMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const dockerError = error as DockerErrorLike;
  if (dockerError.statusCode !== 404) {
    return false;
  }

  const text = getDockerErrorText(error);
  return text.includes("no such") || text.includes("no such image");
}

export function isDockerRuntimeUnavailableError(error: unknown): boolean {
  const text = getDockerErrorText(error);
  return text.includes("unknown runtime specified")
    || text.includes("runtime not found")
    || text.includes("unknown or invalid runtime name")
    || text.includes("invalid runtime name");
}

export function buildMissingSandboxImageMessage(config: SandboxConfig): string {
  return [
    `Sandbox image "${config.image}" is not available on Docker host ${config.dockerHost}.`,
    "Build or pull the configured sandbox image before starting tasks or terminal sessions.",
    "If you are using the bundled Docker Compose or Coolify stack, make sure the sandbox-runtime service is included in the deployment.",
    "You can also build it manually with: docker compose build sandbox-runtime"
  ].join(" ");
}

export function buildMissingSandboxRuntimeMessage(config: SandboxConfig, availableRuntimes?: string[]): string {
  const runtimeName = config.runtime?.trim() ?? "(unset)";
  const availableRuntimeList = (availableRuntimes ?? []).filter((value) => value.trim().length > 0);

  return [
    `Sandbox container runtime "${runtimeName}" is not available on Docker host ${config.dockerHost}.`,
    "Register that runtime with the Docker daemon before starting tasks or terminal sessions.",
    availableRuntimeList.length > 0
      ? `Docker currently reports these runtimes: ${availableRuntimeList.join(", ")}.`
      : "If you want gVisor, Docker usually needs a runtime entry such as runsc before Meowbert can request it.",
    "Then set runtime.sandbox.runtime to the exact Docker runtime name you want Meowbert sandboxes to use."
  ].join(" ");
}

export function readDockerRuntimeNames(info: unknown): string[] {
  if (!isPlainRecord(info) || !isPlainRecord(info.Runtimes)) {
    return [];
  }

  return Object.keys(info.Runtimes)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

export function mapManagedSandboxContainer(
  container: Awaited<ReturnType<Docker["listContainers"]>>[number]
): ManagedSandboxContainerSummaryLike | null {
  if (container.Labels?.[SANDBOX_LABEL_KEY] !== "true") {
    return null;
  }

  const createdAt = typeof container.Created === "number" && Number.isFinite(container.Created)
    ? new Date(container.Created * 1000).toISOString()
    : null;

  return {
    containerId: container.Id,
    image: container.Image,
    state: normalizeContainerLabel(container.State) ?? "unknown",
    status: normalizeContainerLabel(container.Status) ?? "unknown",
    createdAt,
    purpose: normalizeSandboxPurpose(container.Labels?.[SANDBOX_PURPOSE_LABEL_KEY]),
    workspaceId: normalizeContainerLabel(container.Labels?.[SANDBOX_WORKSPACE_ID_LABEL_KEY]),
    environmentId: normalizeContainerLabel(container.Labels?.[SANDBOX_ENVIRONMENT_ID_LABEL_KEY]),
    taskId: normalizeContainerLabel(container.Labels?.[SANDBOX_TASK_ID_LABEL_KEY]),
    runId: normalizeContainerLabel(container.Labels?.[SANDBOX_RUN_ID_LABEL_KEY]),
    sessionId: normalizeContainerLabel(container.Labels?.[SANDBOX_SESSION_ID_LABEL_KEY]),
    parentContainerId: normalizeContainerLabel(container.Labels?.[SANDBOX_PARENT_CONTAINER_ID_LABEL_KEY])
  };
}
