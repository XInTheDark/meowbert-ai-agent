import { describe, expect, it } from "vitest";
import type { TaskLiveSyncFileSummary } from "../../agent/live-sync-types.js";
import { resolveLiveSyncSearchFolder } from "./live-sync-folder-search.js";

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

describe("resolveLiveSyncSearchFolder", () => {
  const files = [
    link("inputs/research"),
    link("inputs/research/nested-link"),
    link("inputs/onedrive", { provider: "onedrive" }),
    link("inputs/spec.docx", { linkKind: "file" })
  ];

  it("routes a folder below a linked Drive folder to the closest link", () => {
    expect(resolveLiveSyncSearchFolder(files, "inputs/research/2024/Q1/")).toMatchObject({
      link: { taskRelativePath: "inputs/research" },
      subfolder: "2024/Q1"
    });
    expect(resolveLiveSyncSearchFolder(files, "./inputs/research/nested-link")).toMatchObject({
      link: { taskRelativePath: "inputs/research/nested-link" },
      subfolder: null
    });
  });

  it("rejects paths that are not inside a linked Google Drive folder", () => {
    expect(resolveLiveSyncSearchFolder(files, "inputs/research-old")).toBeNull();
    expect(resolveLiveSyncSearchFolder(files, "inputs/onedrive")).toBeNull();
    expect(resolveLiveSyncSearchFolder(files, "inputs/spec.docx")).toBeNull();
  });
});
