/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCanvasesPage } from "./ProjectCanvasesPage";

const { apiGet, workspaceAppValue } = vi.hoisted(() => {
  const get = vi.fn();
  return {
    apiGet: get,
    workspaceAppValue: {
      api: { get },
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

describe("ProjectCanvasesPage", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      items: [{
        id: "canvas-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        name: "Quadratics Lab",
        slug: "quadratics-lab",
        rootPath: "canvases/quadratics-lab",
        entryPath: "index.html",
        runtimeMode: "static",
        devServer: {},
        lastTaskId: "task-1",
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z"
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

  it("loads the canvas list on the Overview child route", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ProjectCanvasesPage />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledWith("/api/projects/project-1/canvases");
    expect(container.textContent).toContain("Canvases");
    expect(container.textContent).toContain("Quadratics Lab");
    expect(container.textContent).toContain("New canvas");
  });
});
