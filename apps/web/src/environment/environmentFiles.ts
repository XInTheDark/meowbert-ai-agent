import type { DirectorySizeEntry, EnvironmentFileEntry } from "../lib/types";

export type FileSortColumn = "name" | "sizeBytes" | "kind" | "createdAt" | "modifiedAt";
export type FileSortDirection = "asc" | "desc";

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function toTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function compareByColumn(left: EnvironmentFileEntry, right: EnvironmentFileEntry, column: FileSortColumn): number {
  if (column === "name") {
    return compareText(left.name, right.name);
  }

  if (column === "kind") {
    return compareText(left.kind, right.kind);
  }

  if (column === "sizeBytes") {
    return compareNullableNumber(left.sizeBytes, right.sizeBytes);
  }

  if (column === "createdAt") {
    return compareNullableNumber(toTimestamp(left.createdAt), toTimestamp(right.createdAt));
  }

  return compareNullableNumber(toTimestamp(left.modifiedAt), toTimestamp(right.modifiedAt));
}

export function sortEnvironmentFileEntries(
  entries: EnvironmentFileEntry[],
  column: FileSortColumn,
  direction: FileSortDirection
): EnvironmentFileEntry[] {
  const sorted = [...entries];
  sorted.sort((left, right) => {
    const primaryComparison = compareByColumn(left, right, column);
    const fallbackComparison = compareText(left.name, right.name);
    const comparison = primaryComparison !== 0 ? primaryComparison : fallbackComparison;
    return direction === "asc" ? comparison : -comparison;
  });
  return sorted;
}

export function normalizeEnvironmentPathInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "";
  }

  const slashNormalized = trimmed.replace(/\\/g, "/");
  const withoutLeadingSlash = slashNormalized.replace(/^\/+/, "");
  const collapsed = withoutLeadingSlash.replace(/\/+/g, "/");
  return collapsed.replace(/\/$/, "");
}

export function mergeDirectorySizes(
  entries: EnvironmentFileEntry[],
  directorySizes: DirectorySizeEntry[]
): EnvironmentFileEntry[] {
  if (directorySizes.length === 0) {
    return entries;
  }

  const sizeByRelativePath = new Map(directorySizes.map((entry) => [entry.relativePath, entry.sizeBytes]));
  return entries.map((entry) => {
    if (entry.kind !== "directory") {
      return entry;
    }

    const sizeBytes = sizeByRelativePath.get(entry.relativePath);
    return typeof sizeBytes === "number"
      ? { ...entry, sizeBytes }
      : entry;
  });
}
