/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContext } from "../../contexts/WorkspaceContext";
import type { WorkspaceContextValue } from "../../lib/types";
import { EnvironmentIndexPage } from "./EnvironmentIndexPage";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});


function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise
  };
}

function createWorkspaceContextValue(): WorkspaceContextValue {
  return {
    api: {
      get: vi.fn(),
      post: vi.fn(),
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    },
    token: "token",
    user: null,
    workspaces: [],
    environments: [
      {
        id: "env_active",
        workspace_id: "ws_1",
        name: "Active environment",
        status: "active",
        created_at: "2026-03-30T00:00:00.000Z",
        updated_at: "2026-03-30T00:00:00.000Z"
      },
      {
        id: "env_archived",
        workspace_id: "ws_1",
        name: "Cold storage",
        status: "archived",
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z"
      }
    ],
    tasks: [],
    workspaceSettings: null,
    isWorkspaceSettingsLoading: false,
    activeWorkspaceId: "ws_1",
    activeEnvironmentId: null,
    isBootstrapping: false,
    isEnvironmentsLoading: false,
    isTasksLoading: false,
    setFlash: vi.fn(),
    refreshWorkspaces: vi.fn(async () => undefined),
    refreshEnvironments: vi.fn(async () => undefined),
    refreshTasks: vi.fn(async () => undefined),
    refreshWorkspaceSettings: vi.fn(async () => undefined),
    createWorkspace: vi.fn(async () => undefined),
    createEnvironment: vi.fn(async () => undefined),
    patchEnvironment: vi.fn(async () => undefined),
    replaceSessionToken: vi.fn()
  };
}

describe("EnvironmentIndexPage", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    navigateMock.mockReset();
  });

  it("keeps archived environments collapsed by default and reveals them on demand", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <WorkspaceContext.Provider value={createWorkspaceContextValue()}>
            <EnvironmentIndexPage />
          </WorkspaceContext.Provider>
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain("Active environment");
    expect(container.textContent).toContain("Archived projects");
    expect(container.textContent).not.toContain("Cold storage");

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[title="Show archived projects"]')?.click();
    });

    expect(container.textContent).toContain("Cold storage");
  });

  it("guards against duplicate create submissions while a request is in flight", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const deferred = createDeferred();
    const contextValue = createWorkspaceContextValue();
    const createEnvironmentMock = vi.fn(() => deferred.promise);
    contextValue.createEnvironment = createEnvironmentMock;

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <WorkspaceContext.Provider value={contextValue}>
            <EnvironmentIndexPage />
          </WorkspaceContext.Provider>
        </MemoryRouter>
      );
    });

    const nameInput = container?.querySelector<HTMLInputElement>('input[placeholder="New project name..."]');
    const form = container?.querySelector<HTMLFormElement>('form.env-create-inline');

    await act(async () => {
      if (nameInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        valueSetter?.call(nameInput, "Fast clicks");
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createEnvironmentMock).toHaveBeenCalledTimes(1);
    expect(createEnvironmentMock).toHaveBeenCalledWith("Fast clicks");
    expect(container?.querySelector<HTMLButtonElement>('button[title="Creating project"]')?.disabled).toBe(true);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(container?.querySelector<HTMLButtonElement>('button[title="Create project"]')?.disabled).toBe(true);
  });
});
