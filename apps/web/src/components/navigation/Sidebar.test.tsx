/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({
    user: { display_name: "Ada Lovelace", email: "ada@example.com", is_super_admin: false },
    workspaces: [{ id: "ws1", name: "Workspace One" }],
    environments: [
      { id: "p1", name: "Project One" },
      { id: "p2", name: "Project Two" }
    ],
    activeWorkspaceId: "ws1",
    activeEnvironmentId: "p1",
    api: { primeGet: vi.fn(), prefetchGet: vi.fn(() => Promise.resolve()) }
  })
}));

vi.mock("../../contexts/AppRuntimeContext", () => ({
  useAppRuntime: () => ({
    capabilities: { isDesktop: false, supportsServerProfiles: false },
    activeServerProfile: null
  })
}));

vi.mock("../../onboarding/OnboardingManager", () => ({
  useOnboarding: () => ({
    hasInProgressTutorial: false,
    isTutorialRunning: false,
    openTutorial: vi.fn(),
    restartTutorial: vi.fn()
  })
}));

vi.mock("../workspaceSwitcher/WorkspaceSwitcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />
}));

vi.mock("../theme/ThemeSwitch", () => ({
  ThemeSwitch: () => <div data-testid="theme-switch" />
}));

vi.mock("../../lib/brand", () => ({
  BrandMark: () => <span data-testid="brand-mark" />
}));

let container: HTMLDivElement;
let root: Root;

function renderSidebar(initialPath = "/app/ws1/projects"): void {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Sidebar
          themeMode="dark"
          setThemeMode={vi.fn()}
          onLogout={vi.fn()}
          mobileOpen={false}
          onMobileClose={vi.fn()}
        />
      </MemoryRouter>
    );
  });
}

function clickByLabel(label: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!button) {
    throw new Error(`no control labelled ${label}`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  // This jsdom setup does not expose localStorage as a global.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ announcements: [] }) })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.querySelectorAll(".sidebar-menu-panel").forEach((node) => node.remove());
  vi.unstubAllGlobals();
});

describe("Sidebar", () => {
  it("renders labelled navigation when expanded", () => {
    renderSidebar();

    const labels = Array.from(container.querySelectorAll(".nav-link")).map((node) => node.textContent);
    expect(labels).toContain("All Projects");
    expect(labels).toContain("Search");
    expect(labels).toContain("New Task");
    expect(labels).toContain("Project One");
    expect(labels).not.toContain("Terminal");
    expect(labels).not.toContain("Overview");
    expect(labels).not.toContain("Files");
    expect(labels).not.toContain("Canvases");
    expect(container.querySelector(".sidebar-brand-title")).not.toBeNull();
  });

  it("keeps project destinations selected while their local tools are open", () => {
    renderSidebar("/app/ws1/projects/p1/files");

    const projectLink = container.querySelector<HTMLAnchorElement>('.project-link[href="/app/ws1/projects/p1"]');
    expect(projectLink?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('.sidebar-new-task-link')?.getAttribute("href"))
      .toBe("/app/ws1/projects/p1/tasks/new");
    expect(container.querySelector('a[href="/app/ws1/projects/p1/files"]')).toBeNull();
    expect(container.querySelector('a[href="/app/ws1/projects/p1/canvases"]')).toBeNull();
  });

  it("keeps workspace destinations and New Task reachable in the collapsed rail", () => {
    renderSidebar();
    const expandedCount = container.querySelectorAll(".nav-link").length;

    clickByLabel("Collapse Sidebar");

    expect(container.querySelector(".sidebar")?.className).toContain("collapsed");
    // Project shortcuts move behind All Projects; workspace actions retain labels.
    const railLinks = Array.from(container.querySelectorAll(".nav-link"));
    expect(railLinks.map((link) => link.getAttribute("aria-label"))).toEqual([
      "New Task",
      "All Projects",
      "Search",
      "Notifications",
      "Subscription",
      "Workspace Settings"
    ]);
    expect(railLinks.length).toBe(expandedCount - 2);
    expect(railLinks.every((link) => link.querySelector("svg"))).toBe(true);
    expect(container.querySelector('[aria-label="Expand Sidebar"]')).not.toBeNull();
  });

  it("restores the expanded sidebar from the rail", () => {
    renderSidebar();
    clickByLabel("Collapse Sidebar");
    clickByLabel("Expand Sidebar");

    expect(container.querySelector(".sidebar")?.className).not.toContain("collapsed");
    expect(container.querySelector(".sidebar-brand-title")).not.toBeNull();
  });

  it("collapses the footer to an account and a help control", () => {
    renderSidebar();

    const footer = container.querySelector(".sidebar-footer");
    expect(footer?.querySelectorAll(".sidebar-menu-trigger").length).toBe(2);
    // The old footer rendered every one of these as a peer button.
    expect(footer?.textContent).not.toContain("Docs");
    expect(footer?.textContent).not.toContain("Logout");
    expect(footer?.textContent).not.toContain("Announcements");
  });

  it("exposes account actions in the account menu", () => {
    renderSidebar();
    clickByLabel("Ada Lovelace");

    const panel = document.querySelector(".sidebar-menu-panel");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Preferences");
    expect(panel?.textContent).toContain("Log out");
    expect(panel?.querySelector('[data-testid="theme-switch"]')).not.toBeNull();
  });

  it("exposes help resources in the help menu", () => {
    renderSidebar();
    clickByLabel("Help and resources");

    const panel = document.querySelector(".sidebar-menu-panel");
    expect(panel?.textContent).toContain("Docs");
    expect(panel?.textContent).toContain("Start Tutorial");
    expect(panel?.textContent).toContain("What's New");
    expect(panel?.textContent).toContain("Announcements");
    expect(panel?.textContent).toContain("Download Desktop App");
  });
});
