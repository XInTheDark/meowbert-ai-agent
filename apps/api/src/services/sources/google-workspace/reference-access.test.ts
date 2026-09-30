import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const folderMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/db.js", () => ({ query: queryMock }));
vi.mock("./folder-reference-access.js", () => ({ resolveGoogleWorkspaceFolderReference: folderMock }));
vi.mock("../../../lib/config.js", () => ({
  secrets: { jwtSecret: "test-google-workspace-access-secret" }
}));

import { authorizeGoogleWorkspaceReference } from "./reference-access.js";
import { signGoogleWorkspaceReference, verifyGoogleWorkspaceReferenceToken } from "./reference-signing.js";
import type { GoogleWorkspaceReferencePayload } from "./reference-types.js";

function buildReference(scope: GoogleWorkspaceReferencePayload["scope"]): string {
  return signGoogleWorkspaceReference({
    version: 1,
    kind: "google_workspace_reference",
    sourceId: "google-drive",
    provider: "google-drive",
    itemReference: "doc-1",
    itemId: "doc-1",
    resourceKey: null,
    name: "Brief",
    mimeType: "application/vnd.google-apps.document",
    webUrl: null,
    scope
  });
}

describe("authorizeGoogleWorkspaceReference", () => {
  beforeEach(() => {
    queryMock.mockReset();
    folderMock.mockReset();
    folderMock.mockRejectedValue(Object.assign(new Error("Folder is not attached"), { statusCode: 403 }));
    queryMock.mockResolvedValue({
      rows: [{ allowed: true }]
    });
  });

  it("allows a project reference for a task in the same project", async () => {
    await expect(authorizeGoogleWorkspaceReference({
      referenceToken: buildReference({
        kind: "project",
        workspaceId: "workspace-1",
        environmentId: "project-1",
        taskId: null
      }),
      routeSourceId: "google-drive",
      ticket: {
        taskId: "task-1",
        workspaceId: "workspace-1",
        sourceId: "google-drive"
      }
    })).resolves.toMatchObject({ itemId: "doc-1" });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining(
      "JOIN google_workspace_project_references"
    ), ["task-1", "workspace-1", "project-1", "google-drive", "doc-1"]);
  });

  it("rejects a reference that is not in the Project allowlist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(authorizeGoogleWorkspaceReference({
      referenceToken: buildReference({
        kind: "project",
        workspaceId: "workspace-1",
        environmentId: "project-1",
        taskId: null
      }),
      routeSourceId: "google-drive",
      ticket: {
        taskId: "task-1",
        workspaceId: "workspace-1",
        sourceId: "google-drive"
      }
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects a project reference from another project", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(authorizeGoogleWorkspaceReference({
      referenceToken: buildReference({
        kind: "project",
        workspaceId: "workspace-1",
        environmentId: "project-1",
        taskId: null
      }),
      routeSourceId: "google-drive",
      ticket: {
        taskId: "task-1",
        workspaceId: "workspace-1",
        sourceId: "google-drive"
      }
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rechecks folder access on every use and revokes a previously resolved reference", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const referenceToken = buildReference({ kind: "project", workspaceId: "workspace-1", environmentId: "project-1", taskId: null });
    const input = { referenceToken, routeSourceId: "google-drive", ticket: { taskId: "task-1", workspaceId: "workspace-1", sourceId: "google-drive" } };
    folderMock.mockResolvedValueOnce(verifyGoogleWorkspaceReferenceToken(referenceToken));
    await expect(authorizeGoogleWorkspaceReference(input)).resolves.toMatchObject({ itemId: "doc-1" });
    await expect(authorizeGoogleWorkspaceReference(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(folderMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a copied signed reference even when the other Project has the same folder", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const referenceToken = buildReference({ kind: "project", workspaceId: "workspace-1", environmentId: "project-1", taskId: null });
    const current = verifyGoogleWorkspaceReferenceToken(referenceToken);
    folderMock.mockResolvedValue({ ...current, scope: { ...current.scope, environmentId: "project-2" } });
    await expect(authorizeGoogleWorkspaceReference({
      referenceToken, routeSourceId: "google-drive", ticket: { taskId: "task-2", workspaceId: "workspace-1", sourceId: "google-drive" }
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});
