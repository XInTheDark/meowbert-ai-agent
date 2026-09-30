import { describe, expect, it } from "vitest";
import type { SourceFileEntry } from "../../sources/sourceTypes";
import {
  sortSourceBrowserEntries,
  toSourceBrowserEntry
} from "./sourceFilePickerEntries";

function createSourceEntry(
  name: string,
  overrides: Partial<SourceFileEntry> = {}
): SourceFileEntry {
  return {
    id: overrides.id ?? name,
    name,
    kind: overrides.kind ?? "file",
    mimeType: overrides.mimeType ?? null,
    sizeBytes: overrides.sizeBytes ?? null,
    modifiedAt: overrides.modifiedAt ?? null,
    parentId: overrides.parentId ?? null,
    displayPath: overrides.displayPath
  };
}

describe("sourceFilePickerEntries", () => {
  it("uses only the actual name for result rows", () => {
    const entry = createSourceEntry("dissatisfactio.docx", {
      displayPath: "OneDrive/Research/Surveys/dissatisfactio.docx"
    });

    expect(toSourceBrowserEntry(entry).name).toBe("dissatisfactio.docx");
  });

  it("preserves API relevance order until the user chooses a sort column", () => {
    const entries = [
      toSourceBrowserEntry(createSourceEntry("zeta.docx")),
      toSourceBrowserEntry(createSourceEntry("alpha.docx")),
      toSourceBrowserEntry(createSourceEntry("beta.docx"))
    ];

    expect(sortSourceBrowserEntries(entries, "relevance", "asc").map((entry) => entry.name)).toEqual([
      "zeta.docx",
      "alpha.docx",
      "beta.docx"
    ]);
    expect(sortSourceBrowserEntries(entries, "name", "asc").map((entry) => entry.name)).toEqual([
      "alpha.docx",
      "beta.docx",
      "zeta.docx"
    ]);
  });
});
