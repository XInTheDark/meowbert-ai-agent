/** @vitest-environment jsdom */

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceConnectorsController } from "./useWorkspaceConnectorsController";

const loadConnectors = vi.fn(async () => undefined);

vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({
    api: {
      get: vi.fn(),
      post: vi.fn(),
      postForm: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    },
    activeWorkspaceId: "ws_1",
    environments: [
      {
        id: "env_1",
        status: "active"
      }
    ],
    setFlash: vi.fn(),
    workspaces: [
      {
        id: "ws_1",
        role: "owner"
      }
    ],
    workspaceSettings: {
      modelDefaults: {},
      modelRequestTimeoutMs: null,
      effectiveModelRequestTimeoutMs: 300000,
      shellToolMaxTimeoutMs: null,
      effectiveShellToolMaxTimeoutMs: 300000,
      mcpTimeoutMs: null,
      effectiveMcpTimeoutMs: 60000,
      contextCompactionBackend: "native",
      nativeCompactionEnabled: true,
      contextManagementToolsEnabled: true,
      sendMetadataToModel: false,
      systemPrompt: "",
      personalityId: null,
      effectivePersonalityId: "default",
      sandboxNetworkEnabled: null,
      effectiveSandboxNetworkEnabled: true,
      memoryEnabled: false,
      thoughtPersistenceEnabled: true,
      runAsRoot: false
    }
  })
}));

vi.mock("../../../contexts/AppRuntimeContext", () => ({
  useAppRuntime: () => ({
    capabilities: { isDesktop: false },
    platform: { openExternal: vi.fn() }
  })
}));

vi.mock("./useWorkspaceConnectorCatalog", () => ({
  useWorkspaceConnectorCatalog: () => ({
    availableAgents: [],
    availableSkills: [],
    defaultAgentId: null
  })
}));

vi.mock("./useWorkspaceConnectorsLoading", () => ({
  useWorkspaceConnectorsLoading: () => ({
    loadConnectors
  })
}));

vi.mock("./useWorkspaceConnectorsActions", () => ({
  useWorkspaceConnectorsActions: () => ({})
}));

vi.mock("./useWorkspaceSources", () => ({
  useWorkspaceSources: () => ({
    sources: [],
    canManage: true,
    isLoading: false,
    isSaving: false,
    error: null,
    loadSources: vi.fn(async () => undefined),
    handleConnect: vi.fn(async () => undefined),
    handleDisconnect: vi.fn(async () => undefined)
  })
}));

vi.mock("./useConnectorDefaultEnvironmentSelection", () => ({
  useConnectorDefaultEnvironmentSelection: () => undefined
}));

interface Snapshot {
  activeTab: string;
  search: string;
}

function readTabFromSearch(search: string): string {
  return new URLSearchParams(search).get("tab") ?? "telegram";
}

function ControllerHarness(props: { onSnapshot: (snapshot: Snapshot) => void }) {
  const controller = useWorkspaceConnectorsController();
  const location = useLocation();

  useEffect(() => {
    props.onSnapshot({
      activeTab: controller.activeTab,
      search: location.search
    });
  }, [controller.activeTab, location.search, props.onSnapshot]);

  return (
    <div>
      <button id="discord-tab" type="button" onClick={() => controller.setActiveTab("discord")}>
        Discord
      </button>
      <button id="sources-tab" type="button" onClick={() => controller.setActiveTab("sources")}>
        Sources
      </button>
    </div>
  );
}

describe("useWorkspaceConnectorsController", () => {
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
    loadConnectors.mockClear();
  });

  it("keeps the rendered tab and tab query param in sync while switching tabs", async () => {
    const snapshots: Snapshot[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/workspace/connectors?tab=telegram"]}>
          <Routes>
            <Route path="/workspace/connectors" element={<ControllerHarness onSnapshot={(snapshot) => snapshots.push(snapshot)} />} />
          </Routes>
        </MemoryRouter>
      );
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#discord-tab")?.click();
      await Promise.resolve();
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>("#sources-tab")?.click();
      await Promise.resolve();
    });

    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    expect(snapshots.every((snapshot) => snapshot.activeTab === readTabFromSearch(snapshot.search))).toBe(true);
    expect(snapshots.at(-1)).toEqual({
      activeTab: "sources",
      search: "?tab=sources"
    });
  });
});
