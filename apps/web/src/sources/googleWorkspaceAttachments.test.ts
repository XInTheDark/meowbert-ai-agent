import { describe, expect, it } from "vitest";
import {
  getDirectGoogleWorkspaceEntries,
  isGoogleWorkspaceReferenceFileName
} from "./googleWorkspaceAttachments";
import type { SourceFileEntry, WorkspaceSourceSummary } from "./sourceTypes";

const source = {
  provider: "google-drive"
} as WorkspaceSourceSummary;

function entry(name: string, mimeType: string): SourceFileEntry {
  return {
    id: name,
    name,
    kind: "file",
    mimeType,
    sizeBytes: null,
    modifiedAt: null,
    parentId: null
  };
}

describe("Google Workspace attachment helpers", () => {
  it("selects only native Docs, Sheets, and Slides files", () => {
    const nativeDoc = entry("Brief", "application/vnd.google-apps.document");
    const pdf = entry("Brief.pdf", "application/pdf");
    expect(getDirectGoogleWorkspaceEntries({ source, entries: [nativeDoc, pdf] })).toEqual([nativeDoc]);
  });

  it("recognizes direct pointer file names", () => {
    expect(isGoogleWorkspaceReferenceFileName("Roadmap.gslides")).toBe(true);
    expect(isGoogleWorkspaceReferenceFileName("Roadmap.pptx")).toBe(false);
  });
});
