import { useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api";
import { API_CACHE_TTLS } from "../../lib/api-cache";
import { prefetchTaskConversation } from "../../task/taskConversationPrefetch";

// The Master task id never changes for a project, so it is remembered across visits and reloads and
// the conversation renders without waiting on the API. The API still confirms it in the background.
const STORAGE_KEY = "project-master-task-ids";
const masterTaskIds = new Map<string, string>(readStoredTaskIds());

function readStoredTaskIds(): Array<[string, string]> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  } catch {
    return [];
  }
}

function rememberTaskId(projectId: string, taskId: string): void {
  masterTaskIds.set(projectId, taskId);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(masterTaskIds)));
  } catch {
    // Storage may be unavailable; the in-memory copy still covers this session.
  }
}

// Starts the task and its latest messages together, so opening the Master is one round trip, not three.
function prefetchMasterConversation(api: ApiClient, taskId: string): void {
  void api.prefetchGet?.(`/api/tasks/${taskId}?messageDetail=none`, { ttlMs: API_CACHE_TTLS.taskDetail }).catch(() => undefined);
  prefetchTaskConversation(api, taskId);
}

export type ProjectMasterTaskState =
  | { status: "loading" }
  | { status: "ready"; taskId: string }
  | { status: "failed"; message: string };

export function useProjectMasterTaskId(api: ApiClient, projectId: string | null, enabled: boolean): ProjectMasterTaskState {
  const [state, setState] = useState<{ projectId: string; result: ProjectMasterTaskState } | null>(null);
  const cached = projectId ? masterTaskIds.get(projectId) : undefined;

  useEffect(() => {
    if (!enabled || !projectId) return;
    const known = masterTaskIds.get(projectId);
    if (known) prefetchMasterConversation(api, known);
    let cancelled = false;
    api.post<{ taskId: string }>(`/api/projects/${projectId}/master`, {
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).then((result) => {
      if (result.taskId !== known) {
        prefetchMasterConversation(api, result.taskId);
        rememberTaskId(projectId, result.taskId);
      }
      if (!cancelled) setState({ projectId, result: { status: "ready", taskId: result.taskId } });
    }).catch((error: unknown) => {
      if (cancelled || known) return;
      const message = error instanceof Error ? error.message : "Could not open the Project Master.";
      setState({ projectId, result: { status: "failed", message } });
    });
    return () => { cancelled = true; };
  }, [api, enabled, projectId]);

  if (state && state.projectId === projectId && state.result.status === "ready") return state.result;
  if (cached) return { status: "ready", taskId: cached };
  if (state && state.projectId === projectId) return state.result;
  return { status: "loading" };
}
