import fs from "node:fs/promises";
import path from "node:path";
import { normalizeWorkspaceFileHost, isWithinPath, isSupportedLocalExecutor, type TaskExecutionTarget } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";
import { loadWorkspaceFileHost } from "../workspaces/workspace-file-host.js";
import { listDevices } from "./device-service.js";

// Agent Swarm runs locally like a standard task; other workflows and subagents are cloud-only.
export function localTaskFeatureError(input: {
  workflow?: unknown;
  schedule?: unknown;
  tools?: { subtasks?: boolean; scheduleTask?: boolean; computerUse?: boolean };
  bridge?: boolean;
}): string | null {
  const workflow = input.workflow as { type?: string } | undefined;
  if (input.bridge === true) {
    if ((workflow && workflow.type !== "standard") || input.schedule || input.tools?.subtasks) {
      return "Bridge mode supports standard local tasks without workflows, schedules, or subtasks.";
    }
    return null;
  }
  return (workflow && workflow.type !== "standard" && workflow.type !== "agent_swarm") || input.tools?.subtasks
    ? "Local tasks support standard and Agent Swarm runs without other workflows or subtasks."
    : null;
}

export async function loadLocalProjectStorage(projectId: string) {
  const result = await query<{ storage_backend_id: string; workspace_root: string; project_root: string; file_host?: unknown; workspace_id: string }>(
    `SELECT w.id AS workspace_id, w.file_host, w.storage_backend_id, w.root_path AS workspace_root, e.root_path AS project_root
       FROM environments e JOIN workspaces w ON w.id = e.workspace_id WHERE e.id = $1`,
    [projectId]
  );
  const row = result.rows[0];
  if (row && normalizeWorkspaceFileHost(row.file_host, row.storage_backend_id).kind === "device") {
    return { backendId: "workspace:" + row.workspace_id, fileHost: normalizeWorkspaceFileHost(row.file_host, row.storage_backend_id) };
  }
  const backend = config.storage.backends.find((backend) => backend.id === row?.storage_backend_id);
  if (!row || !backend) throw new Error("This project's storage backend is unavailable.");
  const root = await fs.realpath(backend.type === "mounted" ? backend.mountPath : path.dirname(backend.workspacesRoot));
  const roots = await Promise.all([fs.realpath(row.workspace_root), fs.realpath(row.project_root)]);
  if (roots.some((value) => !isWithinPath(root, value))) {
    throw new Error("This project's roots are outside its storage backend and cannot run locally.");
  }
  return { backendId: row.storage_backend_id, fileHost: normalizeWorkspaceFileHost(row.file_host, row.storage_backend_id) };
}

export async function listProjectExecutionTargets(userId: string, projectId: string) {
  if (!config.localExecution.enabled || !config.runApi) return { enabled: false, devices: [] };
  const { backendId, fileHost } = await loadLocalProjectStorage(projectId);
  const devices = (await listDevices(userId)).filter((device) => isSupportedLocalExecutor(device.platform, device.architecture)
    && typeof device.verifiedRoots[backendId] === "string");
  return { enabled: true, fileHost, devices: devices.map(({ id, name, consent }) => ({ id, name, hostMode: consent.hostMode === true })) };
}

export async function loadTaskExecutionTarget(taskId: string): Promise<TaskExecutionTarget | null> {
  const result = await query<{ execution_target: TaskExecutionTarget }>(
    "SELECT execution_target FROM tasks WHERE id = $1", [taskId]
  );
  return result.rows[0]?.execution_target ?? null;
}

export async function validateProjectExecutionTarget(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  executionTarget: TaskExecutionTarget;
  workflow?: unknown;
  schedule?: unknown;
  tools?: { subtasks?: boolean; scheduleTask?: boolean; computerUse?: boolean };
  restricted?: boolean;
  thread?: boolean;
  readOnly?: boolean;
}): Promise<string | null> {
  const fileHost = await loadWorkspaceFileHost(input.workspaceId);
  if (fileHost.kind === "device") {
    if (input.executionTarget.kind !== "local" || input.executionTarget.deviceId !== fileHost.deviceId) {
      return "Tasks must run on the device that holds this workspace's files.";
    }
  }
  if (input.executionTarget.kind !== "local") return null;
  if (!config.localExecution.enabled || config.runApi === undefined) {
    return "Local execution is disabled on this server.";
  }
  const featureError = localTaskFeatureError({
    workflow: input.workflow,
    schedule: input.schedule,
    tools: input.tools,
    bridge: input.executionTarget.bridge === true
  });
  if (featureError) return featureError;
  if (input.thread && input.readOnly === true && input.executionTarget.mode === "host") {
    return "Read-only threads require sandbox mode.";
  }
  if (input.restricted && input.executionTarget.mode === "host") {
    return "Read-only and no-network tasks need the sandbox, not Host mode.";
  }
  const device = await query<{ id: string }>(
    `SELECT id FROM devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND ((platform = 'darwin' AND architecture = 'arm64') OR (platform = 'win32' AND architecture IN ('x64', 'arm64'))) AND ($3 <> 'host' OR consent_json->>'hostMode' = 'true')`,
    [input.executionTarget.deviceId, input.userId, input.executionTarget.mode]
  );
  if ((device.rowCount ?? 0) === 0) {
    return "The selected local device is unavailable.";
  }
  try {
    await loadLocalProjectStorage(input.projectId);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

export async function localTaskMutationError(taskId: string, _userId: string, input: {
  tools?: { subtasks?: boolean; scheduleTask?: boolean; computerUse?: boolean };
  workflow?: unknown; schedule?: unknown; thread?: boolean; readOnly?: boolean;
}): Promise<string | null> {
  const target = await loadTaskExecutionTarget(taskId);
  if (target?.kind !== "local") return null;
  if (!config.localExecution.enabled) return "Local execution is disabled on this server.";
  if (input.thread && input.readOnly === true && target.mode === "host") return "Read-only threads require sandbox mode.";
  const featureError = localTaskFeatureError({ ...input, bridge: target.bridge === true });
  if (featureError) return featureError;
  return null;
}
