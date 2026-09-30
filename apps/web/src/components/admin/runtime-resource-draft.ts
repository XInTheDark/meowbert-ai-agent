export interface RuntimeResourceValues {
  workspaceLimit: number | null;
  sandboxPidsLimit: number | null;
  sandboxMemoryMb: number | null;
  sandboxCpus: number | null;
  workspaceStorageMb: number | null;
  persistentRuntimeComputeCredits: number | null;
  persistentRuntimeLimit: number | null;
}

export interface RuntimeResourceDraft {
  workspaceLimit: string;
  sandboxPidsLimit: string;
  sandboxMemoryMb: string;
  sandboxCpus: string;
  workspaceStorageMb: string;
  persistentRuntimeComputeCredits: string;
  persistentRuntimeLimit: string;
}

export function emptyRuntimeResourceDraft(): RuntimeResourceDraft {
  return {
    workspaceLimit: "",
    sandboxPidsLimit: "",
    sandboxMemoryMb: "",
    sandboxCpus: "",
    workspaceStorageMb: "",
    persistentRuntimeComputeCredits: "",
    persistentRuntimeLimit: ""
  };
}

export function buildRuntimeResourceDraft(values: RuntimeResourceValues): RuntimeResourceDraft {
  return {
    workspaceLimit: values.workspaceLimit !== null ? String(values.workspaceLimit) : "",
    sandboxPidsLimit: values.sandboxPidsLimit !== null ? String(values.sandboxPidsLimit) : "",
    sandboxMemoryMb: values.sandboxMemoryMb !== null ? String(values.sandboxMemoryMb) : "",
    sandboxCpus: values.sandboxCpus !== null ? String(values.sandboxCpus) : "",
    workspaceStorageMb: values.workspaceStorageMb !== null ? String(values.workspaceStorageMb) : "",
    persistentRuntimeComputeCredits: values.persistentRuntimeComputeCredits !== null ? String(values.persistentRuntimeComputeCredits) : "",
    persistentRuntimeLimit: values.persistentRuntimeLimit !== null ? String(values.persistentRuntimeLimit) : ""
  };
}

function parseOptionalPositiveInt(raw: string, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a whole number >= 1 or blank.`);
  }
  return parsed;
}

function parseOptionalNonNegativeInt(raw: string, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a whole number >= 0 or blank.`);
  }
  return parsed;
}

function parseOptionalPositiveNumber(raw: string, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a number > 0 or blank.`);
  }
  return parsed;
}

export function parseRuntimeResourceDraft(draft: RuntimeResourceDraft): RuntimeResourceValues {
  return {
    workspaceLimit: parseOptionalPositiveInt(draft.workspaceLimit, "Workspace limit"),
    sandboxPidsLimit: parseOptionalPositiveInt(draft.sandboxPidsLimit, "PIDs"),
    sandboxMemoryMb: parseOptionalPositiveInt(draft.sandboxMemoryMb, "Memory"),
    sandboxCpus: parseOptionalPositiveNumber(draft.sandboxCpus, "CPUs"),
    workspaceStorageMb: parseOptionalPositiveInt(draft.workspaceStorageMb, "Workspace storage"),
    persistentRuntimeComputeCredits: parseOptionalNonNegativeInt(
      draft.persistentRuntimeComputeCredits,
      "Runtime credits"
    ),
    persistentRuntimeLimit: parseOptionalNonNegativeInt(
      draft.persistentRuntimeLimit,
      "Persistent runtimes"
    )
  };
}
