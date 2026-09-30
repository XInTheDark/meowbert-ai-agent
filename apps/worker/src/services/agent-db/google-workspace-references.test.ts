import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { hasTaskGoogleWorkspaceFolders, listProjectGoogleWorkspaceReferences } from "./google-workspace-references.js";

const mockedQuery = vi.mocked(query);

describe("listProjectGoogleWorkspaceReferences", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("loads the persistent allowlist for the current Project", async () => {
    mockedQuery.mockResolvedValue({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{
        item_id: "doc-1",
        item_reference: "doc-1",
        name: "Brief",
        mime_type: "application/vnd.google-apps.document",
        web_url: "https://docs.google.com/document/d/doc-1/edit",
        reference_token: "project-token"
      }]
    });

    await expect(listProjectGoogleWorkspaceReferences({
      workspaceId: "workspace-1",
      environmentId: "project-1"
    })).resolves.toEqual([{
      path: null,
      itemId: "doc-1",
      itemReference: "doc-1",
      name: "Brief",
      mimeType: "application/vnd.google-apps.document",
      webUrl: "https://docs.google.com/document/d/doc-1/edit",
      referenceToken: "project-token"
    }]);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("google_workspace_project_references"),
      ["workspace-1", "project-1"]
    );
  });

  it.each([true, false])("reports attached-folder tooling availability: %s", async (available) => {
    mockedQuery.mockResolvedValue({ command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ available }] });
    await expect(hasTaskGoogleWorkspaceFolders({ taskId: "task-1", workspaceId: "workspace-1", environmentId: "project-1" })).resolves.toBe(available);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("task_id = $3"), ["workspace-1", "project-1", "task-1"]);
  });
});
