import { createHash } from "node:crypto";
import { resolveInternalApiBaseUrl, signInternalScopedAccessTicket } from "../agent/internal-api-proxy.js";
import type { TaskMessageToolOptions } from "../agent/types.js";

export interface ProjectMasterCaller {
  taskId: string;
  workspaceId: string;
  actorUserId: string | null;
}

// Derives a stable task id so a replayed tool call reuses the task it already created.
export function deriveManagedTaskId(key: string): string {
  const hex = createHash("sha256").update(`project-master:${key}`).digest("hex");
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function postToMasterApi<T>(caller: ProjectMasterCaller, path: string, body: unknown): Promise<T> {
  if (!caller.actorUserId) {
    throw new Error("The Master needs an accountable user to manage tasks.");
  }
  const ticket = signInternalScopedAccessTicket({
    scope: "project_master_proxy",
    userId: caller.actorUserId,
    taskId: caller.taskId,
    workspaceId: caller.workspaceId
  });
  const response = await fetch(
    `${resolveInternalApiBaseUrl()}/api/internal/project-master/${encodeURIComponent(caller.taskId)}${path}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `Master request failed: HTTP ${response.status}`);
  }
  return payload as T;
}

export function createManagedTask(caller: ProjectMasterCaller, input: {
  taskId: string;
  title: string | null;
  message: string;
  tools: TaskMessageToolOptions;
}): Promise<{ taskId: string; reusedExisting: boolean }> {
  // Canvas mode belongs to the Master's own conversation, not to the tasks it starts.
  const { interactiveCanvas: _interactiveCanvas, ...tools } = input.tools;
  return postToMasterApi(caller, "/tasks", { ...input, tools });
}

export function messageManagedTask(caller: ProjectMasterCaller, input: {
  taskId: string;
  message: string;
}): Promise<{ mode: "enqueued" | "interrupting" }> {
  return postToMasterApi(caller, `/tasks/${encodeURIComponent(input.taskId)}/messages`, { message: input.message });
}

export function cancelManagedTask(caller: ProjectMasterCaller, taskId: string): Promise<{ ok: boolean }> {
  return postToMasterApi(caller, `/tasks/${encodeURIComponent(taskId)}/cancel`, {});
}
