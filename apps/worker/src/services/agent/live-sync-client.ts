import { resolveInternalApiBaseUrl, signInternalScopedAccessTicket } from "./internal-api-proxy.js";
import type { TaskLiveSyncStatus } from "./live-sync-types.js";

function buildLiveSyncHeaders(input: {
  userId: string | null;
  taskId: string;
  workspaceId: string;
}): HeadersInit {
  const ticket = signInternalScopedAccessTicket({
    scope: "live_sync_proxy",
    userId: input.userId ?? "system-live-sync-run",
    taskId: input.taskId,
    workspaceId: input.workspaceId
  });

  return {
    authorization: `Bearer ${ticket}`
  };
}

async function parseLiveSyncResponse<T>(response: Response, fallbackPrefix: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const payloadRecord = payload as Record<string, unknown>;
      const errorMessage = typeof payloadRecord.error === "string"
        ? payloadRecord.error
        : typeof payloadRecord.message === "string"
          ? payloadRecord.message
          : null;
      throw new Error(errorMessage ?? `${fallbackPrefix}: HTTP ${response.status}`);
    }

    if (typeof payload === "string" && payload.trim().length > 0) {
      throw new Error(payload.trim());
    }

    throw new Error(`${fallbackPrefix}: HTTP ${response.status}`);
  }

  return payload as T;
}

export async function fetchTaskLiveSyncStatus(input: {
  userId: string | null;
  taskId: string;
  workspaceId: string;
  taskRelativePath: string;
}): Promise<TaskLiveSyncStatus> {
  const url = new URL(`${resolveInternalApiBaseUrl()}/api/internal/live-sync/tasks/${encodeURIComponent(input.taskId)}/status`);
  url.searchParams.set("path", input.taskRelativePath);
  const response = await fetch(url, {
    headers: buildLiveSyncHeaders(input)
  });
  return parseLiveSyncResponse<TaskLiveSyncStatus>(response, "Failed to fetch live sync status");
}

export async function ensureTaskSourceMounts(input: {
  userId: string | null;
  taskId: string;
  workspaceId: string;
}): Promise<string[]> {
  const response = await fetch(`${resolveInternalApiBaseUrl()}/api/internal/live-sync/tasks/${encodeURIComponent(input.taskId)}/mounts`, {
    method: "POST",
    headers: buildLiveSyncHeaders(input)
  });
  const result = await parseLiveSyncResponse<{ ok: boolean; mountPaths: string[] }>(response, "Failed to mount attached source folders");
  if (!Array.isArray(result.mountPaths) || !result.mountPaths.every((value) => typeof value === "string")) {
    throw new Error("The server could not verify attached source folders. Check that API and worker versions match.");
  }
  return result.mountPaths;
}

export async function releaseTaskSourceMounts(input: {
  userId: string | null;
  taskId: string;
  workspaceId: string;
}): Promise<void> {
  const response = await fetch(`${resolveInternalApiBaseUrl()}/api/internal/live-sync/tasks/${encodeURIComponent(input.taskId)}/mounts`, {
    method: "DELETE",
    headers: buildLiveSyncHeaders(input)
  });
  await parseLiveSyncResponse<{ ok: boolean }>(response, "Failed to release attached source mounts");
}

async function mutateTaskLiveSyncFile(input: {
  action: "pull" | "push";
  userId: string | null;
  taskId: string;
  workspaceId: string;
  taskRelativePath: string;
  force?: boolean | null;
}): Promise<TaskLiveSyncStatus> {
  const response = await fetch(
    `${resolveInternalApiBaseUrl()}/api/internal/live-sync/tasks/${encodeURIComponent(input.taskId)}/${input.action}`,
    {
      method: "POST",
      headers: {
        ...buildLiveSyncHeaders(input),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        path: input.taskRelativePath,
        force: input.force ?? false
      })
    }
  );

  return parseLiveSyncResponse<TaskLiveSyncStatus>(
    response,
    input.action === "pull" ? "Failed to pull live sync file" : "Failed to push live sync file"
  );
}

export async function pullTaskLiveSyncFile(input: {
  userId: string | null;
  taskId: string;
  workspaceId: string;
  taskRelativePath: string;
  force?: boolean | null;
}): Promise<TaskLiveSyncStatus> {
  return mutateTaskLiveSyncFile({
    ...input,
    action: "pull"
  });
}

export async function pushTaskLiveSyncFile(input: {
  userId: string | null;
  taskId: string;
  workspaceId: string;
  taskRelativePath: string;
  force?: boolean | null;
}): Promise<TaskLiveSyncStatus> {
  return mutateTaskLiveSyncFile({
    ...input,
    action: "push"
  });
}
