// What the agent reports with update_progress: what it is working on, where things stand, and the
// steps it sees. The task keeps one current plan across turns; each update changes only the parts
// it sends, and the merged plan is what the task and each progress message store.

export type TaskProgressStepStatus = "done" | "active" | "pending";

export interface TaskProgressStep {
  title: string;
  status: TaskProgressStepStatus;
  note: string | null;
}

export interface TaskProgress {
  goal: string | null;
  status: string | null;
  steps: TaskProgressStep[];
}

// A null field keeps what the plan already has; an empty step list clears the steps. A step whose
// note is null keeps the note of the current step with the same title.
export interface TaskProgressUpdate {
  goal: string | null;
  status: string | null;
  steps: TaskProgressStep[] | null;
}

export const TASK_PROGRESS_MAX_STEPS = 12;
const GOAL_MAX_CHARS = 120;
const STEP_MAX_CHARS = 100;
const STATUS_MAX_CHARS = 1500;
const NOTE_MAX_CHARS = 400;
const STEP_STATUSES = new Set<string>(["done", "active", "pending"]);

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function toLine(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const line = value.replace(/\s+/g, " ").trim();
  return line ? truncate(line, maxChars) : null;
}

// Keeps paragraph breaks; collapses other runs of whitespace.
function toText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return text ? truncate(text, maxChars) : null;
}

function normalizeStep(value: unknown): TaskProgressStep | null {
  if (!value || typeof value !== "object") return null;
  const { title, status, note } = value as { title?: unknown; status?: unknown; note?: unknown };
  const line = toLine(title, STEP_MAX_CHARS);
  return line && typeof status === "string" && STEP_STATUSES.has(status)
    ? { title: line, status: status as TaskProgressStepStatus, note: toText(note, NOTE_MAX_CHARS) }
    : null;
}

// An array, even an empty one, replaces the list; only a missing list keeps the current one.
function normalizeSteps(value: unknown): TaskProgressStep[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, TASK_PROGRESS_MAX_STEPS).map(normalizeStep).filter((step): step is TaskProgressStep => step !== null);
}

export function normalizeTaskProgress(value: unknown): TaskProgress | null {
  if (!value || typeof value !== "object") return null;
  const { goal, status, steps } = value as { goal?: unknown; status?: unknown; steps?: unknown };
  const progress: TaskProgress = {
    goal: toLine(goal, GOAL_MAX_CHARS),
    status: toText(status, STATUS_MAX_CHARS),
    steps: normalizeSteps(steps) ?? []
  };
  return progress.goal || progress.status || progress.steps.length > 0 ? progress : null;
}

export function isEmptyTaskProgressUpdate(update: TaskProgressUpdate): boolean {
  return update.goal === null && update.status === null && update.steps === null;
}

// A new goal starts a new plan: its status and step notes are not carried over from the old one.
export function applyTaskProgressUpdate(current: TaskProgress | null, update: TaskProgressUpdate): TaskProgress | null {
  const goal = toLine(update.goal, GOAL_MAX_CHARS);
  const status = toText(update.status, STATUS_MAX_CHARS);
  const steps = normalizeSteps(update.steps);
  const newPlan = goal !== null && goal !== current?.goal;
  const base = newPlan ? null : current;
  const previousNotes = new Map((base?.steps ?? []).map((step) => [step.title, step.note]));
  return normalizeTaskProgress({
    goal: goal ?? current?.goal ?? null,
    status: status ?? base?.status ?? null,
    steps: steps
      ? steps.map((step) => ({ ...step, note: step.note ?? previousNotes.get(step.title) ?? null }))
      : current?.steps ?? []
  });
}
