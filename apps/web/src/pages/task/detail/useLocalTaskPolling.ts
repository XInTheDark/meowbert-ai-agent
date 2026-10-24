import { useEffect } from "react";
import type { TaskDetail } from "../../../lib/types";

export function useLocalTaskPolling(task: TaskDetail["task"] | undefined, refresh: () => Promise<void>): void {
  const waiting = task?.status === "queued" && task.execution_target?.kind === "local";
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [waiting, task?.id, refresh]);
}
