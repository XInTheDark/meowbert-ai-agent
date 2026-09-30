import { describe, expect, it } from "vitest";
import {
  canUseWorkspaceSourceLiveSync,
  getWorkspaceSourceSetupLabel,
  isWorkspaceSourceReady,
  type WorkspaceSourceSummary
} from "./sourceTypes";

function createSource(overrides?: Partial<WorkspaceSourceSummary>): WorkspaceSourceSummary {
  return {
    id: "youtube",
    name: "YouTube",
    description: "Video metadata",
    provider: "youtube",
    supportsAttachments: true,
    supportsLiveSync: false,
    attachmentMode: "note",
    requiresAdminCredentials: false,
    requiresWorkspaceConnection: false,
    admin: {
      enabled: true,
      configured: true
    },
    connection: {
      connected: false,
      accountLabel: null,
      connectedAt: null,
      canWrite: false
    },
    ...overrides
  };
}

describe("workspace source helpers", () => {
  it("treats no-auth sources as ready once admin enabled them", () => {
    const source = createSource();
    expect(isWorkspaceSourceReady(source)).toBe(true);
    expect(getWorkspaceSourceSetupLabel(source)).toBe("Ready");
  });

  it("still requires workspace connections for OAuth-backed sources", () => {
    const source = createSource({
      provider: "onedrive",
      attachmentMode: "file",
      requiresAdminCredentials: true,
      requiresWorkspaceConnection: true,
      admin: {
        enabled: true,
        configured: true
      },
      connection: {
        connected: false,
        accountLabel: null,
        connectedAt: null,
        canWrite: false
      }
    });

    expect(isWorkspaceSourceReady(source)).toBe(false);
    expect(getWorkspaceSourceSetupLabel(source)).toBe("Connect workspace account");
  });

  it("only enables live sync when the connected source also has write access", () => {
    const readOnly = createSource({
      id: "onedrive",
      name: "OneDrive",
      provider: "onedrive",
      supportsLiveSync: true,
      attachmentMode: "file",
      requiresAdminCredentials: true,
      requiresWorkspaceConnection: true,
      admin: { enabled: true, configured: true },
      connection: {
        connected: true,
        accountLabel: "me@example.com",
        connectedAt: "2026-04-01T00:00:00.000Z",
        canWrite: false
      }
    });
    const writable = {
      ...readOnly,
      connection: {
        ...readOnly.connection,
        canWrite: true
      }
    };

    expect(canUseWorkspaceSourceLiveSync(readOnly)).toBe(false);
    expect(canUseWorkspaceSourceLiveSync(writable)).toBe(true);
  });
});
