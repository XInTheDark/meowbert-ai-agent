import {
  sortEnvironmentFileEntries,
  type FileSortColumn
} from "../../environment/environmentFiles";
import type { EnvironmentFileEntry } from "../../lib/types";
import type { SourceFileEntry } from "../../sources/sourceTypes";

export type SourcePickerMode = "browse" | "search";
export type SourcePickerSortColumn = FileSortColumn | "relevance";

export function toSourceBrowserEntry(
  entry: SourceFileEntry
): EnvironmentFileEntry {
  return {
    name: entry.name,
    relativePath: entry.id,
    kind: entry.kind === "folder" ? "directory" : "file",
    sizeBytes: entry.sizeBytes,
    createdAt: null,
    modifiedAt: entry.modifiedAt
  };
}

export function sortSourceBrowserEntries(
  entries: EnvironmentFileEntry[],
  column: SourcePickerSortColumn,
  direction: "asc" | "desc"
): EnvironmentFileEntry[] {
  if (column === "relevance") {
    return [...entries];
  }

  return sortEnvironmentFileEntries(entries, column, direction);
}
