export interface PlatformSpecializedModels {
  internalModel: string | null;
  fastModel: string | null;
  memorySynthesisAgent: string | null;
  reviewerAgent: string | null;
  subagentFastAgent: string | null;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizePlatformSpecializedModels(value: unknown): PlatformSpecializedModels {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { internalModel: null, fastModel: null, memorySynthesisAgent: null, reviewerAgent: null, subagentFastAgent: null };
  }

  const record = value as Record<string, unknown>;
  return {
    internalModel: normalizeIdentifier(record.internalModel),
    fastModel: normalizeIdentifier(record.fastModel),
    memorySynthesisAgent: normalizeIdentifier(record.memorySynthesisAgent),
    reviewerAgent: normalizeIdentifier(record.reviewerAgent),
    subagentFastAgent: normalizeIdentifier(record.subagentFastAgent)
  };
}

export function resolveFastModel(input: {
  specializedModels: PlatformSpecializedModels;
  fallbackModel: string;
}): string {
  return input.specializedModels.fastModel ?? input.fallbackModel;
}

// The internal model handles background work such as task titles and connector routing.
export function resolveInternalModel(input: {
  specializedModels: PlatformSpecializedModels;
  fallbackModel: string;
}): string {
  return input.specializedModels.internalModel ?? input.fallbackModel;
}
