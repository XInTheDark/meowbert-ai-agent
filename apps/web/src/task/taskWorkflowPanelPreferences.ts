import type { TaskWorkflowType } from "../lib/types";

const TASK_WORKFLOW_PANEL_OPEN_STORAGE_PREFIX = "meowbert_task_workflow_panel_open";

interface TaskWorkflowPanelPreferenceInput {
  taskId: string;
  workflowType: TaskWorkflowType;
}

function buildTaskWorkflowPanelStorageKey(input: TaskWorkflowPanelPreferenceInput): string {
  return `${TASK_WORKFLOW_PANEL_OPEN_STORAGE_PREFIX}:${input.taskId}:${input.workflowType}`;
}

export function readTaskWorkflowPanelOpenPreference(
  input: TaskWorkflowPanelPreferenceInput,
  fallback = true
): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawValue = window.localStorage.getItem(buildTaskWorkflowPanelStorageKey(input));
    if (rawValue === "1") {
      return true;
    }
    if (rawValue === "0") {
      return false;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function writeTaskWorkflowPanelOpenPreference(
  input: TaskWorkflowPanelPreferenceInput,
  isOpen: boolean
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(buildTaskWorkflowPanelStorageKey(input), isOpen ? "1" : "0");
  } catch {
    // Ignore localStorage write failures so the panel still works for the current session.
  }
}
