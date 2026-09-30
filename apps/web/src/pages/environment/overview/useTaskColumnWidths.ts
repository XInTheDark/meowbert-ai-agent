import { useEffect, useState } from "react";
import {
  DEFAULT_TASK_COLUMN_WIDTHS,
  TASK_LIST_COLUMN_STORAGE_KEY,
  type ResizableTaskColumn
} from "./projectOverviewTypes";
import { readStoredTaskColumnWidths } from "./projectOverviewUtils";

export function useTaskColumnWidths() {
  const [taskColumnWidths, setTaskColumnWidths] = useState<Record<ResizableTaskColumn, number>>(
    () => readStoredTaskColumnWidths() ?? { ...DEFAULT_TASK_COLUMN_WIDTHS }
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(TASK_LIST_COLUMN_STORAGE_KEY, JSON.stringify(taskColumnWidths));
    } catch {
      // Ignore storage write failures.
    }
  }, [taskColumnWidths]);

  return { taskColumnWidths, setTaskColumnWidths };
}
