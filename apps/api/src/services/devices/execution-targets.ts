import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath, type TaskExecutionTarget } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";
import { listDevices } from "./device-service.js";

export function localTaskFeatureError(input: {
  workflow?: unknown;
  schedule?: unknown;
  swarm?: boolean;
  tools?: { subtasks?: boolean; scheduleTask?: boolean; computerUse?: boolean };
}): string | null {
  const workflow = input.workflow as { type?: string } | undefined;
  return (workflow && workflow.type !== "standard") || input.schedule || input.swarm || input.tools?.subtasks || input.tools?.scheduleTask || input.tools?.computerUse
    ? "Local tasks support standard sandbox runs without workflows, schedules, subtasks, or host tools."
    : null;
}

export async function loadLocalProjectStorage(projectId: string) {
  const result = await query<{ storage_backend_id: string; workspace_root: string; project_root: string }>(
    `SELECT w.storage_backend_id, w.root_path AS workspace_root, e.root_path AS project_root
       FROM environments e JOIN workspaces w ON w.id = e.workspace_id WHERE e.id = $1`,
    [projectId]
  );
  const row = result.rows[0];
  const backend = config.storage.backends.find((backend) => backend.id === row?.storage_backend_id);
  if (!row || !backend) throw new Error("This project's storage backend is unavailable.");
  const root = await fs.realpath(backend.type === "mounted" ? backend.mountPath : path.dirname(backend.workspacesRoot));
  const roots = await Promise.all([fs.realpath(row.workspace_root), fs.realpath(row.project_root)]);
  if (roots.some((value) => !isWithinPath(root, value))) {
    throw new Error("This project's roots are outside its storage backend and cannot run locally.");
  }
  return { backendId: row.storage_backend_id };
}

export async function listProjectExecutionTargets(userId: string, projectId: string) {
  if (!config.localExecution.enabled || !config.runApi) return { enabled: false, devices: [] };
  const { backendId } = await loadLocalProjectStorage(projectId);
  const devices = (await listDevices(userId)).filter((device) => device.platform === "darwin"
    && device.architecture === "arm64" && typeof device.verifiedRoots[backendId] === "string");
  return { enabled: true, devices: devices.map(({ id, name }) => ({ id, name })) };
}

export async function loadTaskExecutionTarget(taskId: string): Promise<TaskExecutionTarget | null> {
  const result = await query<{ execution_target: TaskExecutionTarget }>(
    "SELECT execution_target FROM tasks WHERE id = $1", [taskId]
  );
  return result.rows[0]?.execution_target ?? null;
}

export async function localTaskMutationError(taskId: string, userId: string, input: {
  tools?: { subtasks?: boolean; scheduleTask?: boolean; computerUse?: boolean };
  agent?: { id: string } | null; workflow?: unknown; schedule?: unknown; thread?: boolean;
}): Promise<string | null> {
  const target = await loadTaskExecutionTarget(taskId);
  if (target?.kind !== "local") return null;
  if (!config.localExecution.enabled) return "Local execution is disabled on this server.";
  if (input.thread) return "Threads are unavailable for local tasks.";
  const featureError = localTaskFeatureError(input);
  if (featureError) return featureError;
  if (input.agent) {
    const { getVisiblePlatformAgentsForUser } = await import("../platform/platform-agents.js");
    const { findPlatformAgentPresetById, resolvePlatformAgentPresetMode } = await import("@meowbert/shared");
    const context = await getVisiblePlatformAgentsForUser(userId);
    if (resolvePlatformAgentPresetMode(findPlatformAgentPresetById(context.presets, input.agent.id)) === "agent_swarm") {
      return "Agent Swarm is unavailable for local tasks.";
    }
  }
  return null;
}
