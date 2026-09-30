import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createReferenceFile,
  fetchRemoteSnapshot,
  importSourceFile,
  upsertProjectReference
} = vi.hoisted(() => ({
  createReferenceFile: vi.fn(),
  fetchRemoteSnapshot: vi.fn(),
  importSourceFile: vi.fn(),
  upsertProjectReference: vi.fn()
}));

vi.mock("./source-catalog.js", () => ({
  getSourceCatalogEntry: vi.fn(() => ({
    manifest: { name: "Google Drive" },
    provider: "google-drive",
    supportsLiveSync: true,
    attachmentMode: "file"
  }))
}));
vi.mock("./file-import.js", () => ({ importWorkspaceSourceFileToEnvironment: importSourceFile }));
vi.mock("./youtube-metadata.js", () => ({ createYoutubeMetadataNoteAttachment: vi.fn() }));
vi.mock("../source-file-links/service.js", () => ({ createLiveSyncSourceAttachment: vi.fn() }));
vi.mock("../source-file-links/google-drive-remote.js", () => ({
  fetchGoogleDriveRemoteSnapshot: fetchRemoteSnapshot
}));
vi.mock("./google-workspace/reference-files.js", () => ({
  createGoogleWorkspaceReferenceFile: createReferenceFile
}));
vi.mock("./google-workspace/reference-allowlist.js", () => ({
  upsertGoogleWorkspaceProjectReference: upsertProjectReference
}));

import { attachWorkspaceSource } from "./source-attachments.js";

describe("attachWorkspaceSource direct Google Workspace mode", () => {
  beforeEach(() => {
    createReferenceFile.mockReset();
    fetchRemoteSnapshot.mockReset();
    importSourceFile.mockReset();
    upsertProjectReference.mockReset();
  });

  it("creates a pointer instead of exporting the native Google file", async () => {
    fetchRemoteSnapshot.mockResolvedValue({
      kind: "file",
      name: "Roadmap",
      mimeType: "application/vnd.google-apps.document",
      webUrl: "https://docs.google.com/document/d/doc-1/edit"
    });
    createReferenceFile.mockResolvedValue({
      name: "Roadmap.gdoc",
      relativePath: "inputs/Roadmap.gdoc",
      sizeBytes: 512,
      createdAt: null,
      modifiedAt: null,
      mimeType: "application/vnd.google-apps.document",
      webUrl: "https://docs.google.com/document/d/doc-1/edit",
      reference: {
        itemId: "doc-1",
        scope: { kind: "project", environmentId: "project-1" }
      }
    });

    const result = await attachWorkspaceSource({
      workspaceId: "workspace-1",
      sourceId: "google-drive",
      actorUserId: "user-1",
      environmentId: "project-1",
      environmentRootPath: "/tmp/project",
      workspaceRootPath: "/tmp/workspace",
      taskId: "task-1",
      itemId: "doc-1",
      destinationPath: "inputs",
      googleWorkspaceMode: "direct"
    });

    expect(fetchRemoteSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "doc-1",
      requireWriteAccess: true
    }));
    expect(createReferenceFile).toHaveBeenCalledWith(expect.objectContaining({
      itemReference: "doc-1",
      environmentId: "project-1"
    }));
    expect(upsertProjectReference).toHaveBeenCalledWith({
      reference: expect.objectContaining({ itemId: "doc-1" }),
      actorUserId: "user-1"
    });
    expect(importSourceFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "file",
      name: "Roadmap.gdoc",
      googleWorkspaceReference: { direct: true }
    });
  });
});
