export type OnboardingProgressStatus = "not_started" | "in_progress" | "completed";

export interface OnboardingProgressRecord {
  version: number;
  status: OnboardingProgressStatus;
  stepIndex: number;
  lastSeenAt: string;
  lastWorkspaceId: string | null;
}

const ONBOARDING_PROGRESS_VERSION = 1;
const ONBOARDING_PROGRESS_KEY_PREFIX = "meowbert_onboarding_progress_v1:";

function buildStorageKey(userId: string): string {
  return `${ONBOARDING_PROGRESS_KEY_PREFIX}${userId}`;
}

function normalizeRecord(raw: unknown): OnboardingProgressRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const status = record.status;
  const stepIndex = record.stepIndex;
  const lastSeenAt = record.lastSeenAt;
  const lastWorkspaceId = record.lastWorkspaceId;

  if (status !== "not_started" && status !== "in_progress" && status !== "completed") {
    return null;
  }
  if (typeof stepIndex !== "number" || !Number.isInteger(stepIndex) || stepIndex < 0) {
    return null;
  }
  if (typeof lastSeenAt !== "string") {
    return null;
  }
  if (lastWorkspaceId !== null && typeof lastWorkspaceId !== "string") {
    return null;
  }

  return {
    version:
      typeof record.version === "number" && Number.isInteger(record.version)
        ? record.version
        : ONBOARDING_PROGRESS_VERSION,
    status,
    stepIndex,
    lastSeenAt,
    lastWorkspaceId
  };
}

export function readOnboardingProgress(userId: string): OnboardingProgressRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(buildStorageKey(userId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeRecord(parsed);
    if (!normalized) {
      return null;
    }

    if (normalized.version !== ONBOARDING_PROGRESS_VERSION) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

export function writeOnboardingProgress(userId: string, record: OnboardingProgressRecord): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalized: OnboardingProgressRecord = {
    version: ONBOARDING_PROGRESS_VERSION,
    status: record.status,
    stepIndex: Math.max(0, Math.floor(record.stepIndex)),
    lastSeenAt: record.lastSeenAt,
    lastWorkspaceId: record.lastWorkspaceId ?? null
  };

  window.localStorage.setItem(buildStorageKey(userId), JSON.stringify(normalized));
}

export function clearOnboardingProgress(userId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(buildStorageKey(userId));
}

export function createOnboardingProgressRecord(
  input: Pick<OnboardingProgressRecord, "status" | "stepIndex" | "lastWorkspaceId">
): OnboardingProgressRecord {
  return {
    version: ONBOARDING_PROGRESS_VERSION,
    status: input.status,
    stepIndex: Math.max(0, Math.floor(input.stepIndex)),
    lastSeenAt: new Date().toISOString(),
    lastWorkspaceId: input.lastWorkspaceId ?? null
  };
}
