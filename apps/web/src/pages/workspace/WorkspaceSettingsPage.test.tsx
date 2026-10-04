/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspaceApp: vi.fn() }));
vi.mock("../../components/tasks/ToolOptionsDropdown", () => ({ ToolOptionsDropdown: () => null }));
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { WorkspaceSettingsPage } from "./WorkspaceSettingsPage";

const patch = vi.fn(async () => ({}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.mocked(useWorkspaceApp).mockReturnValue({
    api: { get: vi.fn(async () => ({ items: [], skills: [], defaultId: null })), patch }, activeWorkspaceId: "workspace",
    workspaces: [{ id: "workspace", name: "Workspace", role: "owner" }], workspaceSettings: { modelDefaults: {} },
    isWorkspaceSettingsLoading: false, refreshWorkspaceSettings: vi.fn(async () => {}), setFlash: vi.fn(), user: null
  } as never);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function showExperiments() {
  await act(async () => root.render(<MemoryRouter><WorkspaceSettingsPage /></MemoryRouter>));
  await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Experiments")!.click());
}
async function save() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
describe("workspace organization experiment", () => {
  it("defaults on without pinning the inherited default when saving other experiments", async () => {
    await showExperiments();
    const label = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.includes("New message organization"))!;
    expect(label.querySelector("input")?.checked).toBe(true);
    await save();
    expect(patch).toHaveBeenCalledWith("/api/workspaces/workspace/settings", { nativeCompactionEnabled: true, sendMetadataToModel: false, claudeCacheKeepalive: true, codeModeEnabled: true });
  });
  it("persists an explicit disable", async () => {
    await showExperiments();
    const label = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.includes("New message organization"))!;
    await act(async () => label.querySelector<HTMLInputElement>("input")!.click());
    await save();
    expect(patch).toHaveBeenCalledWith("/api/workspaces/workspace/settings", expect.objectContaining({ newMessageOrganizationEnabled: false }));
  });
});
describe("workspace code mode experiment", () => {
  it("starts on and saves when turned off", async () => {
    await showExperiments();
    const label = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.includes("Code mode"))!;
    expect(label.querySelector("input")?.checked).toBe(true);
    await act(async () => label.querySelector<HTMLInputElement>("input")!.click());
    await save();
    expect(patch).toHaveBeenCalledWith("/api/workspaces/workspace/settings", expect.objectContaining({ codeModeEnabled: false }));
  });
});
