import { useCallback, useEffect, useRef } from "react";
import { createCoalescedRefreshController } from "./taskDetailEventSync";

const TASK_REFRESH_DEBOUNCE_MS = 250;

export function useTaskDetailEventRefresh(loadTaskSnapshot: () => Promise<void>): () => void {
  const taskRefreshControllerRef = useRef<ReturnType<typeof createCoalescedRefreshController> | null>(null);

  useEffect(() => {
    const controller = createCoalescedRefreshController(loadTaskSnapshot, TASK_REFRESH_DEBOUNCE_MS);
    taskRefreshControllerRef.current = controller;

    return () => {
      controller.cancel();
      if (taskRefreshControllerRef.current === controller) {
        taskRefreshControllerRef.current = null;
      }
    };
  }, [loadTaskSnapshot]);

  return useCallback((): void => {
    taskRefreshControllerRef.current?.schedule();
  }, []);
}
