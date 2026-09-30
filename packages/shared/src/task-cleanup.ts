interface PlainObject {
  [key: string]: unknown;
}

export const TASK_CLEANUP_EXPIRATION_DAYS_MIN = 1;
export const TASK_CLEANUP_EXPIRATION_DAYS_MAX = 3650;

export interface TaskCleanupSettings {
  expirationDays: number | null;
}

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeTaskCleanupExpirationDays(rawValue: unknown): number | null {
  const parsed = toNumber(rawValue);
  if (parsed === null) {
    return null;
  }

  const rounded = Math.floor(parsed);
  if (rounded < TASK_CLEANUP_EXPIRATION_DAYS_MIN || rounded > TASK_CLEANUP_EXPIRATION_DAYS_MAX) {
    return null;
  }

  return rounded;
}

export function parseTaskCleanupSettings(rawPayload: unknown): TaskCleanupSettings {
  if (!isPlainObject(rawPayload)) {
    return { expirationDays: null };
  }

  const cleanupSettings = rawPayload.task_cleanup;
  if (!isPlainObject(cleanupSettings)) {
    return { expirationDays: null };
  }

  return {
    expirationDays: normalizeTaskCleanupExpirationDays(
      cleanupSettings.expiration_days ?? cleanupSettings.expirationDays
    )
  };
}
