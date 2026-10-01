import { useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api";

// The Master task id never changes for a project, so revisits render the conversation without waiting on the API.
const masterTaskIds = new Map<string, string>();

export type ProjectMasterTaskState =
  | { status: "loading" }
  | { status: "ready"; taskId: string }
  | { status: "failed"; message: string };

export function useProjectMasterTaskId(api: ApiClient, projectId: string | null, enabled: boolean): ProjectMasterTaskState {
  const cached = projectId ? masterTaskIds.get(projectId) : undefined;
  const [state, setState] = useState<{ projectId: string; result: ProjectMasterTaskState } | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || masterTaskIds.has(projectId)) return;
    let cancelled = false;
    api.post<{ taskId: string }>(`/api/projects/${projectId}/master`, {
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).then((result) => {
      masterTaskIds.set(projectId, result.taskId);
      if (!cancelled) setState({ projectId, result: { status: "ready", taskId: result.taskId } });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : "Could not open the Project Master.";
      setState({ projectId, result: { status: "failed", message } });
    });
    return () => { cancelled = true; };
  }, [api, enabled, projectId]);

  if (cached) return { status: "ready", taskId: cached };
  if (state && state.projectId === projectId) return state.result;
  return { status: "loading" };
}
