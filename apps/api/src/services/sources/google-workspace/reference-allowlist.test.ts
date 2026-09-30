import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/db.js", () => ({ query: queryMock }));

import { upsertGoogleWorkspaceProjectReference } from "./reference-allowlist.js";

describe("upsertGoogleWorkspaceProjectReference", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it("stores direct access at Project scope", async () => {
    await upsertGoogleWorkspaceProjectReference({
      actorUserId: "user-1",
      reference: {
        version: 1,
        kind: "google_workspace_reference",
        sourceId: "google-drive",
        provider: "google-drive",
        itemReference: "doc-1",
        itemId: "doc-1",
        resourceKey: null,
        name: "Brief",
        mimeType: "application/vnd.google-apps.document",
        webUrl: "https://docs.google.com/document/d/doc-1/edit",
        scope: {
          kind: "project",
          workspaceId: "workspace-1",
          environmentId: "project-1",
          taskId: null
        },
        referenceToken: "project-token"
      }
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (environment_id, source_id, item_id)"),
      [
        "workspace-1",
        "project-1",
        "google-drive",
        "doc-1",
        "doc-1",
        null,
        "Brief",
        "application/vnd.google-apps.document",
        "https://docs.google.com/document/d/doc-1/edit",
        "project-token",
        "user-1"
      ]
    );
  });
});
