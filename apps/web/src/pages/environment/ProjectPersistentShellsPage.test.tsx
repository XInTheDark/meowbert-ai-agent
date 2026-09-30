/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPersistentShellsPage } from "./ProjectPersistentShellsPage";

const { apiGet, apiPost, workspaceAppValue } = vi.hoisted(() => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    apiGet: get,
    apiPost: post,
    workspaceAppValue: {
      api: { get, post },
      activeWorkspaceId: "workspace-1",
      activeProjectId: "project-1",
      activeEnvironmentId: "project-1",
      projects: [{ id: "project-1", name: "Math" }],
      environments: [{ id: "project-1", name: "Math" }]
    }
  };
});

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => workspaceAppValue
}));

describe("ProjectPersistentShellsPage", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPost.mockResolvedValue({ terminated: 1 });
    apiGet.mockResolvedValue({
      items: [{
        id: "shell-1",
        status: "running",
        command: "npm run dev",
        workingDir: "/workspace",
        startedAt: "2026-09-02T01:00:00.000Z",
        updatedAt: "2026-09-02T01:01:00.000Z",
        output: "Listening on http://localhost:3000"
      }]
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows read-only active shell output", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ProjectPersistentShellsPage />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/persistent-shell-sessions?includeOutput=true&outputTailLines=800"
    );
    expect(container.textContent).toContain("Background shells");
    expect(container.textContent).toContain("Read-only live output");
    expect(container.textContent).toContain("npm run dev");
    expect(container.textContent).toContain("Listening on http://localhost:3000");
    expect(container.textContent).toContain("running");

    const commandDetails = container.querySelector(".persistent-shell-command-details");
    expect(commandDetails).toBeTruthy();
    expect(commandDetails?.querySelector("summary")?.getAttribute("title")).toBe("Expand command");
    expect(commandDetails?.querySelector(".persistent-shell-command-expanded")?.textContent).toBe("npm run dev");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".persistent-shell-terminate-btn")?.click();
      await Promise.resolve();
    });
    expect(apiPost).toHaveBeenCalledWith(
      "/api/projects/project-1/persistent-shell-sessions/shell-1/terminate",
      {}
    );
  });
});
