// Limits the composer can put on a new task. They are kept per project like the rest of the
// composer, so a project that is usually read-only stays that way for the next task.
export interface TaskRestrictions {
  readOnly: boolean;
  networkDisabled: boolean;
}

export const DEFAULT_TASK_RESTRICTIONS: TaskRestrictions = { readOnly: false, networkDisabled: false };

export function normalizeTaskRestrictions(value: unknown): TaskRestrictions {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof TaskRestrictions, unknown>>;
  return {
    readOnly: candidate.readOnly === true,
    networkDisabled: candidate.networkDisabled === true
  };
}

export function hasTaskRestrictions(restrictions: TaskRestrictions): boolean {
  return restrictions.readOnly || restrictions.networkDisabled;
}

// Only what is switched on goes to the server, so a default task sends nothing.
export function buildCreateTaskRestrictionsPayload(restrictions: TaskRestrictions): Partial<TaskRestrictions> | null {
  if (!hasTaskRestrictions(restrictions)) {
    return null;
  }

  return {
    ...(restrictions.readOnly ? { readOnly: true } : {}),
    ...(restrictions.networkDisabled ? { networkDisabled: true } : {})
  };
}
