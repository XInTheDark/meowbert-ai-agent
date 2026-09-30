import type { SourceFileEntry, WorkspaceSourceSummary } from "./sourceTypes";

const GOOGLE_WORKSPACE_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation"
]);

export function getDirectGoogleWorkspaceEntries(input: {
  source: WorkspaceSourceSummary | null;
  entries: SourceFileEntry[];
}): SourceFileEntry[] {
  if (input.source?.provider !== "google-drive") {
    return [];
  }
  return input.entries.filter((entry) => (
    entry.kind === "file"
    && entry.mimeType !== null
    && GOOGLE_WORKSPACE_MIME_TYPES.has(entry.mimeType)
  ));
}

export function isGoogleWorkspaceReferenceFileName(value: string): boolean {
  return /\.(gdoc|gsheet|gslides)$/i.test(value);
}
