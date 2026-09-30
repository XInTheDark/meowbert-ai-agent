export type DraftNumberMode = "integer" | "decimal";

export function formatDraftNumberValue(value: number, mode: DraftNumberMode): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  return mode === "integer" ? String(Math.trunc(value)) : String(value);
}

export function parseDraftNumberValue(raw: string, mode: DraftNumberMode): number | null {
  if (raw.trim().length === 0) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (mode === "integer" && !Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

export function isDraftNumberWithinBounds(input: {
  value: number;
  min?: number;
  max?: number;
}): boolean {
  if (typeof input.min === "number" && input.value < input.min) {
    return false;
  }
  if (typeof input.max === "number" && input.value > input.max) {
    return false;
  }
  return true;
}

export function clampDraftNumberValue(input: {
  value: number;
  mode: DraftNumberMode;
  min?: number;
  max?: number;
}): number {
  let nextValue = input.mode === "integer" ? Math.trunc(input.value) : input.value;

  if (typeof input.min === "number") {
    nextValue = Math.max(input.min, nextValue);
  }
  if (typeof input.max === "number") {
    nextValue = Math.min(input.max, nextValue);
  }

  return nextValue;
}
