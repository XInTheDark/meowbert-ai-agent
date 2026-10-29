// What the agent reports with update_progress: what it is working on and the steps it sees. The
// list is the agent's current view, so each update replaces the last one whole.

export type TaskProgressStepStatus = "done" | "active" | "pending";

export interface TaskProgressStep {
  title: string;
  status: TaskProgressStepStatus;
}

export interface TaskProgress {
  goal: string | null;
  steps: TaskProgressStep[];
}

export const TASK_PROGRESS_MAX_STEPS = 12;
const GOAL_MAX_CHARS = 120;
const STEP_MAX_CHARS = 100;
const STEP_STATUSES = new Set<string>(["done", "active", "pending"]);

function toLine(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const line = value.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}

function normalizeStep(value: unknown): TaskProgressStep | null {
  if (!value || typeof value !== "object") return null;
  const { title, status } = value as { title?: unknown; status?: unknown };
  const line = toLine(title, STEP_MAX_CHARS);
  return line && typeof status === "string" && STEP_STATUSES.has(status)
    ? { title: line, status: status as TaskProgressStepStatus }
    : null;
}

export function normalizeTaskProgress(value: unknown): TaskProgress | null {
  if (!value || typeof value !== "object") return null;
  const { goal, steps } = value as { goal?: unknown; steps?: unknown };
  const normalizedSteps = Array.isArray(steps)
    ? steps.slice(0, TASK_PROGRESS_MAX_STEPS).map(normalizeStep).filter((step): step is TaskProgressStep => step !== null)
    : [];
  const normalizedGoal = toLine(goal, GOAL_MAX_CHARS);
  return normalizedGoal || normalizedSteps.length > 0 ? { goal: normalizedGoal, steps: normalizedSteps } : null;
}
