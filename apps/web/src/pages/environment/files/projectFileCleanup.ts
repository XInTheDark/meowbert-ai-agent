import type { ProjectCleanupPlanResponse } from "../../../lib/types";

const BYTES_PER_MEBIBYTE = 1024 * 1024;

export interface CleanupFilterFormState {
  modifiedAfter: string;
  modifiedBefore: string;
  minSizeMb: string;
  maxSizeMb: string;
}

export const EMPTY_CLEANUP_FILTERS: CleanupFilterFormState = {
  modifiedAfter: "",
  modifiedBefore: "",
  minSizeMb: "",
  maxSizeMb: ""
};

function parseCleanupSizeInput(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * BYTES_PER_MEBIBYTE);
}

export function buildCleanupPlanQuery(targetPercent: number, filters: CleanupFilterFormState): string {
  const params = new URLSearchParams({ targetPercent: String(targetPercent) });
  if (filters.modifiedAfter) {
    params.set("modifiedAfter", filters.modifiedAfter);
  }
  if (filters.modifiedBefore) {
    params.set("modifiedBefore", filters.modifiedBefore);
  }

  const minSizeBytes = parseCleanupSizeInput(filters.minSizeMb);
  if (minSizeBytes !== null) {
    params.set("minSizeBytes", String(minSizeBytes));
  }
  const maxSizeBytes = parseCleanupSizeInput(filters.maxSizeMb);
  if (maxSizeBytes !== null) {
    params.set("maxSizeBytes", String(maxSizeBytes));
  }
  return params.toString();
}

export function buildDefaultCleanupSelection(plan: ProjectCleanupPlanResponse): Set<string> {
  const selected = new Set<string>();
  let selectedBytes = 0;
  for (const entry of plan.suggestions) {
    if (selectedBytes >= plan.targetBytes) {
      break;
    }
    selected.add(entry.relativePath);
    selectedBytes += entry.sizeBytes;
  }
  return selected;
}
