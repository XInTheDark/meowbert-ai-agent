import { describe, expect, it } from "vitest";
import { buildSourceFileLinkStatus } from "./status.js";
import type { SourceFileLink, SourceFileLinkLocalSnapshot, SourceFileLinkRemoteSnapshot } from "./types.js";

function createLink(overrides?: Partial<SourceFileLink>): SourceFileLink {
  return {
    id: "link-1",
    workspaceId: "ws-1",
    environmentId: "env-1",
    taskId: "task-1",
    provider: "onedrive",
    sourceId: "onedrive",
    linkKind: "file",
    remoteItemId: "remote-1",
    remoteName: "Quarterly Report.docx",
    remoteMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    remoteWebUrl: "https://example.com/report",
    localRelativePath: ".meowbert/task-runs/task-1/inputs/report.docx",
    syncMode: "manual",
    lastSyncedRemoteEtag: "etag-1",
    lastSyncedRemoteCtag: "ctag-1",
    lastSyncedRemoteModifiedAt: "2026-04-01T00:00:00.000Z",
    lastSyncedRemoteSizeBytes: 100,
    lastSyncedLocalHash: "hash-1",
    lastSyncedLocalSizeBytes: 100,
    lastSyncedLocalModifiedAt: "2026-04-01T00:00:00.000Z",
    lastPulledAt: "2026-04-01T00:00:00.000Z",
    lastPushedAt: null,
    lastSyncError: null,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides
  };
}

function createLocal(overrides?: Partial<SourceFileLinkLocalSnapshot>): SourceFileLinkLocalSnapshot {
  return {
    exists: true,
    relativePath: ".meowbert/task-runs/task-1/inputs/report.docx",
    kind: "file",
    sizeBytes: 100,
    modifiedAt: "2026-04-01T00:00:00.000Z",
    hash: "hash-1",
    ...overrides
  };
}

function createRemote(overrides?: Partial<SourceFileLinkRemoteSnapshot>): SourceFileLinkRemoteSnapshot {
  return {
    itemId: "remote-1",
    kind: "file",
    name: "Quarterly Report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    webUrl: "https://example.com/report",
    modifiedAt: "2026-04-01T00:00:00.000Z",
    sizeBytes: 100,
    eTag: "etag-1",
    cTag: "ctag-1",
    ...overrides
  };
}

describe("buildSourceFileLinkStatus", () => {
  it("marks matching local and remote files as synced", () => {
    const status = buildSourceFileLinkStatus({
      link: createLink(),
      local: createLocal(),
      remote: createRemote()
    });

    expect(status.status).toBe("synced");
    expect(status.canPull).toBe(false);
    expect(status.canPush).toBe(false);
  });

  it("marks local edits as pushable", () => {
    const status = buildSourceFileLinkStatus({
      link: createLink(),
      local: createLocal({ hash: "hash-2" }),
      remote: createRemote()
    });

    expect(status.status).toBe("local_modified");
    expect(status.canPush).toBe(true);
    expect(status.supportsForcePull).toBe(true);
  });

  it("marks remote edits as pullable", () => {
    const status = buildSourceFileLinkStatus({
      link: createLink(),
      local: createLocal(),
      remote: createRemote({ eTag: "etag-2" })
    });

    expect(status.status).toBe("remote_modified");
    expect(status.canPull).toBe(true);
    expect(status.supportsForcePush).toBe(true);
  });

  it("marks simultaneous local and remote edits as conflict", () => {
    const status = buildSourceFileLinkStatus({
      link: createLink(),
      local: createLocal({ hash: "hash-2" }),
      remote: createRemote({ eTag: "etag-2" })
    });

    expect(status.status).toBe("conflict");
    expect(status.canPull).toBe(true);
    expect(status.canPush).toBe(true);
    expect(status.supportsForcePull).toBe(true);
    expect(status.supportsForcePush).toBe(true);
  });

  it("marks missing remote files explicitly", () => {
    const status = buildSourceFileLinkStatus({
      link: createLink(),
      local: createLocal(),
      remote: null
    });

    expect(status.status).toBe("missing_remote");
    expect(status.canPull).toBe(false);
    expect(status.canPush).toBe(false);
  });

  it("marks matching local and remote folders as synced by tree hash", () => {
    const status = buildSourceFileLinkStatus({
      link: createLink({
        linkKind: "folder",
        localRelativePath: ".meowbert/task-runs/task-1/inputs/research",
        lastSyncedRemoteCtag: "tree-1",
        lastSyncedLocalHash: "tree-1",
        lastSyncedLocalSizeBytes: 200,
        lastSyncedRemoteSizeBytes: 200
      }),
      local: createLocal({
        relativePath: ".meowbert/task-runs/task-1/inputs/research",
        kind: "folder",
        hash: "tree-1",
        sizeBytes: 200
      }),
      remote: createRemote({
        kind: "folder",
        name: "Research",
        cTag: "tree-1",
        eTag: null,
        sizeBytes: 200
      })
    });

    expect(status.status).toBe("synced");
    expect(status.canPull).toBe(false);
    expect(status.canPush).toBe(false);
  });
});
