import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/config.js", () => ({
  secrets: { jwtSecret: "test-google-workspace-signing-secret" }
}));
import {
  signGoogleWorkspaceReference,
  verifyGoogleWorkspaceReferenceToken
} from "./reference-signing.js";
import type { GoogleWorkspaceReferencePayload } from "./reference-types.js";

const payload: GoogleWorkspaceReferencePayload = {
  version: 1,
  kind: "google_workspace_reference",
  sourceId: "google-drive",
  provider: "google-drive",
  itemReference: "doc-1::resourceKey::key-1",
  itemId: "doc-1",
  resourceKey: "key-1",
  name: "Brief",
  mimeType: "application/vnd.google-apps.document",
  webUrl: "https://docs.google.com/document/d/doc-1/edit",
  scope: {
    kind: "project",
    workspaceId: "workspace-1",
    environmentId: "project-1",
    taskId: null
  }
};

describe("Google Workspace reference signing", () => {
  it("round-trips an authorized reference", () => {
    expect(verifyGoogleWorkspaceReferenceToken(signGoogleWorkspaceReference(payload))).toEqual(payload);
  });

  it("rejects a modified reference token", () => {
    const token = signGoogleWorkspaceReference(payload);
    const [encodedPayload, signature] = token.split(".");
    const tamperedSignature = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
    const tampered = `${encodedPayload}.${tamperedSignature}`;
    expect(() => verifyGoogleWorkspaceReferenceToken(tampered)).toThrow(/invalid/i);
  });
});
