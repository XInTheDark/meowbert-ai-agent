import { describe, expect, it } from "vitest";
import type { EnvironmentFileEntry } from "../lib/types";
import {
  normalizeEnvironmentPathInput,
  sortEnvironmentFileEntries
} from "./environmentFiles";

function createEntry(
  name: string,
  partial: Partial<EnvironmentFileEntry> = {}
): EnvironmentFileEntry {
  return {
    name,
    relativePath: partial.relativePath ?? name,
    kind: partial.kind ?? "file",
    sizeBytes: partial.sizeBytes ?? null,
    createdAt: partial.createdAt ?? null,
    modifiedAt: partial.modifiedAt ?? null
  };
}

describe("environmentFiles", () => {
  it("normalizes user path input", () => {
    expect(normalizeEnvironmentPathInput("")).toBe("");
    expect(normalizeEnvironmentPathInput("/")).toBe("");
    expect(normalizeEnvironmentPathInput(" /docs/reference/ ")).toBe("docs/reference");
    expect(normalizeEnvironmentPathInput("logs\\\\2026\\03")).toBe("logs/2026/03");
  });

  it("sorts by timestamps and keeps null values at the end for ascending order", () => {
    const entries = [
      createEntry("b.txt", { modifiedAt: null }),
      createEntry("a.txt", { modifiedAt: "2026-03-02T10:00:00.000Z" }),
      createEntry("c.txt", { modifiedAt: "2026-03-03T10:00:00.000Z" })
    ];

    const asc = sortEnvironmentFileEntries(entries, "modifiedAt", "asc");
    expect(asc.map((entry) => entry.name)).toEqual(["a.txt", "c.txt", "b.txt"]);

    const desc = sortEnvironmentFileEntries(entries, "modifiedAt", "desc");
    expect(desc.map((entry) => entry.name)).toEqual(["b.txt", "c.txt", "a.txt"]);
  });

  it("sorts by size and falls back to name for equal values", () => {
    const entries = [
      createEntry("zeta.log", { sizeBytes: 10 }),
      createEntry("alpha.log", { sizeBytes: 10 }),
      createEntry("beta.log", { sizeBytes: 5 })
    ];

    const sorted = sortEnvironmentFileEntries(entries, "sizeBytes", "asc");
    expect(sorted.map((entry) => entry.name)).toEqual(["beta.log", "alpha.log", "zeta.log"]);
  });
});
