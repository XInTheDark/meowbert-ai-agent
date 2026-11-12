import { describe, expect, it } from "vitest";
import type { TaskLiveSyncFileSummary } from "../../agent/live-sync-types.js";
import { defaultVersionSavePath, findLinkedPathConflict, resolveLiveSyncVersionTarget } from "./live-sync-file-versions.js";

function link(taskRelativePath: string, overrides: Partial<TaskLiveSyncFileSummary> = {}): TaskLiveSyncFileSummary {
  return {
    id: taskRelativePath,
    provider: "google-drive",
    sourceId: "google-drive",
    linkKind: "folder",
    remoteName: taskRelativePath,
    remoteWebUrl: null,
    localRelativePath: taskRelativePath,
    taskRelativePath,
    lastPulledAt: null,
    lastPushedAt: null,
    lastSyncError: null,
    ...overrides
  };
}

const files = [
  link("inputs/research"),
  link("inputs/research/nested-link"),
  link("inputs/spec.docx", { linkKind: "file" }),
  link("inputs/onedrive", { provider: "onedrive" })
];

describe("resolveLiveSyncVersionTarget", () => {
  it("targets a linked file directly and a file in a folder through the closest folder link", () => {
    expect(resolveLiveSyncVersionTarget(files, "./inputs/spec.docx")).toMatchObject({ link: { taskRelativePath: "inputs/spec.docx" }, filePath: null });
    expect(resolveLiveSyncVersionTarget(files, "inputs/research/2024/Plan.url")).toMatchObject({
      link: { taskRelativePath: "inputs/research" },
      filePath: "2024/Plan.url"
    });
    expect(resolveLiveSyncVersionTarget(files, "inputs/research/nested-link/a.pdf")).toMatchObject({
      link: { taskRelativePath: "inputs/research/nested-link" },
      filePath: "a.pdf"
    });
  });

  it("rejects folders themselves and items outside Google Drive links", () => {
    expect(resolveLiveSyncVersionTarget(files, "inputs/research/")).toMatchObject({ error: expect.stringMatching(/Folders have no version history/) });
    expect(resolveLiveSyncVersionTarget(files, "inputs/onedrive/a.docx")).toHaveProperty("error");
    expect(resolveLiveSyncVersionTarget(files, "inputs/research-old/a.docx")).toHaveProperty("error");
  });
});

describe("findLinkedPathConflict", () => {
  it("blocks saving into a mounted folder or over a linked file, and allows everything else", () => {
    expect(findLinkedPathConflict(files, "/task", "/task/inputs/research/copy.pdf")).toBe("inputs/research");
    expect(findLinkedPathConflict(files, "/task", "/task/inputs/spec.docx")).toBe("inputs/spec.docx");
    expect(findLinkedPathConflict(files, "/task", "/task/drive-versions/spec@2026.docx")).toBeNull();
    expect(findLinkedPathConflict(files, "/task", "/task/inputs/research-old/copy.pdf")).toBeNull();
  });
});

describe("defaultVersionSavePath", () => {
  it("names the copy after the file and the version's time, outside any link", () => {
    expect(defaultVersionSavePath({ fileName: "Plan.docx", modifiedAt: "2026-03-01T10:20:30.123Z", versionId: "r1" }))
      .toBe("drive-versions/Plan@2026-03-01T10-20-30Z.docx");
    expect(defaultVersionSavePath({ fileName: "notes", modifiedAt: null, versionId: "abc/1" }))
      .toBe("drive-versions/notes@abc_1");
  });
});
