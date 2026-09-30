import { describe, expect, it } from "vitest";
import { authorizeGoogleWorkspaceRequest } from "./proxy-policy.js";
import type { GoogleWorkspaceReferencePayload } from "./reference-types.js";

const reference: GoogleWorkspaceReferencePayload = {
  version: 1,
  kind: "google_workspace_reference",
  sourceId: "google-drive",
  provider: "google-drive",
  itemReference: "file-1",
  itemId: "file-1",
  resourceKey: null,
  name: "Attached file",
  mimeType: "application/vnd.google-apps.spreadsheet",
  webUrl: null,
  scope: {
    kind: "project",
    workspaceId: "workspace-1",
    environmentId: "project-1",
    taskId: null
  }
};

describe("authorizeGoogleWorkspaceRequest", () => {
  it("allows retained API paths for the signed file and strips credential headers", () => {
    const request = authorizeGoogleWorkspaceRequest({
      reference,
      request: {
        method: "POST",
        url: "https://sheets.googleapis.com/v4/spreadsheets/file-1:batchUpdate?alt=json",
        headers: {
          authorization: "Bearer sandbox-token",
          cookie: "session=bad",
          "content-type": "application/json"
        },
        bodyBase64: Buffer.from("{}").toString("base64")
      }
    });

    expect(request.mutating).toBe(true);
    expect(request.headers).toEqual({ "content-type": "application/json" });
    expect(request.body?.toString("utf8")).toBe("{}");
  });

  it("allows Slides thumbnail reads for the signed presentation", () => {
    expect(() => authorizeGoogleWorkspaceRequest({
      reference: {
        ...reference,
        itemId: "deck-1",
        mimeType: "application/vnd.google-apps.presentation"
      },
      request: {
        method: "GET",
        url: "https://slides.googleapis.com/v1/presentations/deck-1/pages/page-1/thumbnail?alt=json",
        headers: {},
        bodyBase64: null
      }
    })).not.toThrow();
  });

  it("rejects a request for another Google file", () => {
    expect(() => authorizeGoogleWorkspaceRequest({
      reference,
      request: {
        method: "GET",
        url: "https://sheets.googleapis.com/v4/spreadsheets/other-file",
        headers: {},
        bodyBase64: null
      }
    })).toThrow(/directly attached file/i);
  });

  it("rejects using the wrong Workspace API for the signed file type", () => {
    expect(() => authorizeGoogleWorkspaceRequest({
      reference,
      request: {
        method: "GET",
        url: "https://docs.googleapis.com/v1/documents/file-1",
        headers: {},
        bodyBase64: null
      }
    })).toThrow(/file type/i);
  });

  it("rejects generic Drive listing endpoints", () => {
    expect(() => authorizeGoogleWorkspaceRequest({
      reference,
      request: {
        method: "GET",
        url: "https://www.googleapis.com/drive/v3/files?q=trashed%3Dfalse",
        headers: {},
        bodyBase64: null
      }
    })).toThrow(/directly attached file/i);
  });

  it("rejects destructive methods that are not exposed by the retained tools", () => {
    expect(() => authorizeGoogleWorkspaceRequest({
      reference,
      request: {
        method: "DELETE",
        url: "https://www.googleapis.com/drive/v3/files/file-1",
        headers: {},
        bodyBase64: null
      }
    })).toThrow(/method is not allowed/i);
  });

  it.each([
    ["application/vnd.google-apps.document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["application/vnd.google-apps.spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["application/vnd.google-apps.presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]
  ] as const)("permits a read-only Office export for %s", (mimeType, exportMime) => {
    const result = authorizeGoogleWorkspaceRequest({
      reference: { ...reference, mimeType },
      request: { method: "GET", url: `https://www.googleapis.com/drive/v3/files/file-1/export?mimeType=${exportMime}`, headers: {}, bodyBase64: null }
    });
    expect(result.mutating).toBe(false);
  });

  it.each([
    "https://www.googleapis.com/drive/v3/files/other-file/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "https://www.googleapis.com/drive/v3/files/file-1/export?mimeType=text/html",
    "https://www.googleapis.com/drive/v3/files/file-1/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&mimeType=text/html"
  ])("rejects unauthorized export targets and formats: %s", (url) => {
    expect(() => authorizeGoogleWorkspaceRequest({ reference, request: { method: "GET", url, headers: {}, bodyBase64: null } })).toThrow();
  });
});
