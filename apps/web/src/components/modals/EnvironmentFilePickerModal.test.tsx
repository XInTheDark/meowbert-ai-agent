/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import type { ApiClient } from "../../lib/api";
import { FilePreviewPane } from "../files/FilePreviewPane";
import { EnvironmentFilePickerModal } from "./EnvironmentFilePickerModal";

vi.mock("../../contexts/AppRuntimeContext", () => ({ useAppRuntime: vi.fn() }));
vi.mock("../files/FilePreviewPane", () => ({ FilePreviewPane: vi.fn(() => null) }));

const entry = { name: "notes.txt", relativePath: "notes.txt", kind: "file", sizeBytes: 5, createdAt: null, modifiedAt: null };
const preview = { relativePath: "notes.txt", sizeBytes: 5, truncated: false, encoding: "utf-8", text: "notes" };
const api = { get: vi.fn() };
const onSelect = vi.fn();
const onClose = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(useAppRuntime).mockReturnValue({ platform: {}, capabilities: { supportsNativeFileDialogs: false } } as never);
  api.get.mockImplementation(async (url: string) => url.includes("/content?")
    ? preview
    : { cwd: "", parentPath: null, items: [entry] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPicker(isOpen: boolean) {
  await act(async () => root.render(
    <EnvironmentFilePickerModal
      api={api as unknown as ApiClient}
      token="quick-agent-token"
      environmentId="project"
      isOpen={isOpen}
      onSelect={onSelect}
      onClose={onClose}
    />
  ));
}

describe("EnvironmentFilePickerModal outside WorkspaceLayout", () => {
  it("keeps the standalone composer mounted when the picker is closed", async () => {
    await renderPicker(false);
    expect(container.childElementCount).toBe(0);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("browses and attaches project files without workspace context", async () => {
    await renderPicker(true);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(api.get).toHaveBeenCalledWith("/api/projects/project/files?path=");
    await act(async () => container.querySelector<HTMLElement>(".file-list-row")!.click());
    const attach = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Attach selected")!;
    await act(async () => attach.click());
    expect(onSelect).toHaveBeenCalledWith([expect.objectContaining({ kind: "file", relativePath: "notes.txt", sizeBytes: 5 })]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("passes the caller's session token to authenticated file previews", async () => {
    await renderPicker(true);
    await act(async () => container.querySelector<HTMLElement>(".file-list-row")!.click());
    expect(api.get).toHaveBeenCalledWith("/api/projects/project/files/content?path=notes.txt");
    expect(vi.mocked(FilePreviewPane).mock.lastCall?.[0]).toMatchObject({
      previewToken: "quick-agent-token",
      selectedEntry: entry,
      filePreview: preview
    });
  });
});
