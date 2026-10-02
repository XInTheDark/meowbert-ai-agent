import { useEffect, useState } from "react";
import type { TaskUsageResponse, TaskUsageSummary } from "@meowbert/shared/token-usage-stats";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";

export function useTaskUsage(taskId: string): {
  usage: TaskUsageSummary | null;
  isLoading: boolean;
  error: string | null;
} {
  const { api } = useWorkspaceApp();
  const [usage, setUsage] = useState<TaskUsageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api.get<TaskUsageResponse>(`/api/tasks/${encodeURIComponent(taskId)}/usage`)
      .then((response) => {
        if (!cancelled) {
          setUsage(response.usage);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, taskId]);

  return { usage, isLoading, error };
}
