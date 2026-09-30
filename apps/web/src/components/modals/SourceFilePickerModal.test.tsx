/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceFilePickerModal } from "./SourceFilePickerModal";
import type { ApiClient } from "../../lib/api";
import type { WorkspaceSourceSummary } from "../../sources/sourceTypes";

const mockSource: WorkspaceSourceSummary = {
  id: "source-1",
  name: "Google Drive",
  description: "Google Drive source",
  provider: "google-drive",
  supportsAttachments: true,
  supportsLiveSync: true,
  attachmentMode: "file",
  requiresAdminCredentials: true,
  requiresWorkspaceConnection: true,
  admin: { enabled: true, configured: true },
  connection: { connected: true, accountLabel: "user@example.com", connectedAt: "2026-01-01", canWrite: true }
};

describe("SourceFilePickerModal", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders path ribbon and updates ribbon when clicking on a file", async () => {
    const mockApi = {
      get: vi.fn().mockImplementation((url: string) => {
        if (url.includes("/browse")) {
          return Promise.resolve({
            folder: { id: null, name: "My Drive", parentId: null },
            items: [
              { id: "f-1", name: "folder-a", kind: "folder", mimeType: null, sizeBytes: null, modifiedAt: null, parentId: null },
              { id: "file-1", name: "notes.txt", kind: "file", mimeType: "text/plain", sizeBytes: 120, modifiedAt: null, parentId: null }
            ]
          });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      }),
      post: vi.fn()
    } as unknown as ApiClient;

    await act(async () => {
      root.render(
        <SourceFilePickerModal
          api={mockApi}
          workspaceId="ws-1"
          environmentId="env-1"
          source={mockSource}
          isOpen
          onClose={vi.fn()}
          onSelect={vi.fn()}
          destinationPath="/docs"
        />
      );
    });

    // Verify initial ribbon displays current folder
    const ribbon = container.querySelector(".source-file-picker-ribbon");
    expect(ribbon).not.toBeNull();
    expect(ribbon?.textContent).toContain("My Drive");

    // Click file row
    const fileRow = container.querySelectorAll(".file-list-row")[1];
    expect(fileRow?.textContent).toContain("notes.txt");
    await act(async () => {
      fileRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Verify ribbon updates to show file path
    expect(ribbon?.textContent).toContain("notes.txt");
    expect(ribbon?.querySelector(".source-file-picker-ribbon-copy")).not.toBeNull();
  });

  it("navigates into directory when double clicking a folder from search results", async () => {
    const mockApi = {
      get: vi.fn().mockImplementation((url: string) => {
        if (url.includes("/browse?folderId=folder-designs")) {
          return Promise.resolve({
            folder: { id: "folder-designs", name: "Designs", parentId: null },
            items: [
              { id: "file-logo", name: "logo.svg", kind: "file", mimeType: "image/svg+xml", sizeBytes: 500, modifiedAt: null, parentId: "folder-designs" }
            ]
          });
        }
        if (url.includes("/browse")) {
          return Promise.resolve({
            folder: { id: null, name: "My Drive", parentId: null },
            items: []
          });
        }
        if (url.includes("/search")) {
          return Promise.resolve({
            items: [
              {
                id: "folder-designs",
                name: "Designs",
                displayPath: "My Drive/Projects/Designs",
                kind: "folder",
                mimeType: "application/vnd.google-apps.folder",
                sizeBytes: null,
                modifiedAt: null,
                parentId: "folder-projects"
              }
            ]
          });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      }),
      post: vi.fn()
    } as unknown as ApiClient;

    await act(async () => {
      root.render(
        <SourceFilePickerModal
          api={mockApi}
          workspaceId="ws-1"
          environmentId="env-1"
          source={mockSource}
          isOpen
          onClose={vi.fn()}
          onSelect={vi.fn()}
          destinationPath="/docs"
        />
      );
    });

    // Enter search query and submit
    const searchInput = container.querySelector(".chat-tools-search-input") as HTMLInputElement;
    const searchForm = container.querySelector(".source-file-picker-search-form") as HTMLFormElement;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(searchInput, "designs");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // Wait for search result row to appear
    const searchRow = container.querySelector(".file-list-row");
    expect(searchRow?.textContent).toContain("Designs");

    // Double-click folder row in search results
    await act(async () => {
      searchRow?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    // Check that /browse was called with folder-designs
    expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining("/browse?folderId=folder-designs")
    );

    // Verify search input was cleared
    expect(searchInput.value).toBe("");

    // Verify ribbon shows the folder path
    const ribbon = container.querySelector(".source-file-picker-ribbon");
    expect(ribbon?.textContent).toContain("Designs");

    // Verify the folder's items are now shown
    const browsedRow = container.querySelector(".file-list-row");
    expect(browsedRow?.textContent).toContain("logo.svg");
  });

  it("navigates to ancestor folder when clicking breadcrumb in ribbon", async () => {
    const mockApi = {
      get: vi.fn().mockImplementation((url: string) => {
        if (url.includes("/browse?folderId=folder-projects")) {
          return Promise.resolve({
            folder: { id: "folder-projects", name: "Projects", parentId: null },
            items: [
              { id: "folder-sub", name: "Sub", kind: "folder", mimeType: null, sizeBytes: null, modifiedAt: null, parentId: "folder-projects" }
            ]
          });
        }
        if (url.includes("/browse")) {
          return Promise.resolve({
            folder: { id: null, name: "My Drive", parentId: null },
            items: [
              { id: "folder-projects", name: "Projects", kind: "folder", mimeType: null, sizeBytes: null, modifiedAt: null, parentId: null }
            ]
          });
        }
        return Promise.reject(new Error(`Unexpected GET ${url}`));
      }),
      post: vi.fn()
    } as unknown as ApiClient;

    await act(async () => {
      root.render(
        <SourceFilePickerModal
          api={mockApi}
          workspaceId="ws-1"
          environmentId="env-1"
          source={mockSource}
          isOpen
          onClose={vi.fn()}
          onSelect={vi.fn()}
          destinationPath="/docs"
        />
      );
    });

    // Double-click Projects to go inside
    const projectRow = container.querySelector(".file-list-row");
    expect(projectRow?.textContent).toContain("Projects");
    await act(async () => {
      projectRow?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    // Verify ribbon has "My Drive" clickable link and "Projects"
    const ribbonLinks = container.querySelectorAll(".source-file-picker-ribbon-link");
    expect(ribbonLinks.length).toBeGreaterThanOrEqual(1);
    expect(ribbonLinks[0]?.textContent).toContain("My Drive");

    // Click "My Drive" link
    await act(async () => {
      ribbonLinks[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Verify it navigated back to root (calls /browse without folderId)
    const ribbon = container.querySelector(".source-file-picker-ribbon");
    expect(ribbon?.textContent).toContain("My Drive");
  });

  it.each([null, "Engineering/Project/Notes"])("shows the actual name and an honest path for a pasted link (%s)", async (displayPath) => {
    const mockApi = {
      get: vi.fn(async (url: string) => url.includes("/path?") ? {
        items: [{ id: "notes", name: "Notes", kind: "folder", displayPath, parentId: "project", sizeBytes: null, modifiedAt: null }]
      } : {
        folder: { id: null, name: "My Drive", parentId: null }, items: []
      })
    } as unknown as ApiClient;
    await act(async () => root.render(
      <SourceFilePickerModal api={mockApi} workspaceId="ws-1" projectId="project-1" environmentId="project-1"
        source={mockSource} isOpen onClose={vi.fn()} onSelect={vi.fn()} />
    ));
    await act(async () => container.querySelector<HTMLButtonElement>(".source-file-picker-lookup-mode-button")!.click());
    const input = container.querySelector<HTMLInputElement>(".chat-tools-search-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://drive.google.com/open?id=notes");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const row = container.querySelector<HTMLElement>(".file-list-row")!;
    expect(row.querySelector(".file-entry-name-text")?.textContent).toBe("Notes");
    await act(async () => row.click());
    const ribbon = container.querySelector(".source-file-picker-ribbon")!;
    expect(ribbon.textContent).not.toContain("My Drive");
    expect(ribbon.textContent).toContain(displayPath ? "Engineering" : "Location unavailable");
    expect(ribbon.querySelectorAll("nav button")).toHaveLength(0);
    expect(container.querySelector(".source-file-picker-location")?.textContent).toBe("Path result");
    if (!displayPath) {
      expect(ribbon.querySelector(".source-file-picker-ribbon-copy")).toBeNull();
    }
  });

});
