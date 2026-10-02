/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectNavigation } from "./ProjectNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workspaceSettings = vi.hoisted(() => ({ modelDefaults: { projectMasterEnabled: true } }));

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({
    activeWorkspaceId: "ws1",
    activeEnvironmentId: "p1",
    environments: [{ id: "p1", name: "Product research" }],
    workspaceSettings
  })
}));

let container: HTMLDivElement;
let root: Root;

function renderNavigation(path: string): void {
  act(() => {
    root.render(<MemoryRouter initialEntries={[path]}><ProjectNavigation /></MemoryRouter>);
  });
}

beforeEach(() => {
  workspaceSettings.modelDefaults.projectMasterEnabled = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ProjectNavigation", () => {
  it.each([
    ["/tasks", "Tasks"],
    ["/files", "Files"],
    ["/context", "Context"],
    ["/canvases", "Canvases"],
    ["/settings", "Settings"]
  ])("selects the local tab for %s", (suffix, label) => {
    renderNavigation(`/app/ws1/projects/p1${suffix}`);

    expect(container.querySelector('nav[aria-label="Project tools"]')).not.toBeNull();
    expect(container.querySelectorAll(".project-tab")).toHaveLength(5);
    const selected = container.querySelectorAll('[aria-current="page"]');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe(label);
    expect(selected[0].getAttribute("href")).toBe(`/app/ws1/projects/p1${suffix}`);
  });

  it("leaves every tab unselected on the Master landing and links Tasks to the full list", () => {
    renderNavigation("/app/ws1/projects/p1");

    expect(container.querySelectorAll(".project-tab.active")).toHaveLength(0);
    const tasksTab = [...container.querySelectorAll(".project-tab")].find((tab) => tab.textContent === "Tasks");
    expect(tasksTab?.getAttribute("href")).toBe("/app/ws1/projects/p1/tasks");
  });

  it("treats the project root as the task list when the Master is off", () => {
    workspaceSettings.modelDefaults.projectMasterEnabled = false;
    renderNavigation("/app/ws1/projects/p1");

    const selected = container.querySelectorAll(".project-tab.active");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe("Tasks");
    expect(selected[0].getAttribute("href")).toBe("/app/ws1/projects/p1");
  });

  it.each(["/tasks/new", "/tasks/task-1", "/canvases/canvas-1"])(
    "keeps focused work at %s connected to its project without stacking tabs",
    (suffix) => {
      renderNavigation(`/app/ws1/projects/p1${suffix}`);

      expect(container.querySelector(".project-tabs")).toBeNull();
      const breadcrumb = container.querySelector(".project-breadcrumb");
      expect(breadcrumb?.textContent).toBe("Product research");
      expect(breadcrumb?.getAttribute("href")).toBe("/app/ws1/projects/p1");
      expect(breadcrumb?.getAttribute("title")).toBe("Back to Product research");
    }
  );

  it.each(["/app/ws1/projects", "/app/ws1/settings", "/app/ws1/search", "/app/ws1/projects/p10"])(
    "does not display a stale project header on %s",
    (path) => {
      renderNavigation(path);
      expect(container.querySelector("header")).toBeNull();
    }
  );
});
