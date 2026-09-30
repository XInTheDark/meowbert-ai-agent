/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectContextPage } from "./ProjectContextPage";

const { api, patchProject, setFlash, project } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  patchProject: vi.fn(),
  setFlash: vi.fn(),
  project: {
    id: "project-1",
    name: "Example",
    json_payload: { project_context: { notes: { "context/spec.txt": "Reference" } } }
  }
}));
vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspaceApp: () => ({ api, patchProject, setFlash, projects: [project], activeProjectId: project.id })
}));
vi.mock("../../contexts/AppRuntimeContext", () => ({
  useAppRuntime: () => ({ platform: {}, capabilities: {} })
}));
vi.mock("../../components/modals/SourceFilePickerModal", () => ({ SourceFilePickerModal: () => null }));
vi.mock("./context/ProjectContextPreviewPane", () => ({ ProjectContextPreviewPane: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProjectContextPage removal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let deleted: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    deleted = false;
    patchProject.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.get.mockImplementation(async (url: string) => url.includes("/content?") ? {} : ({
      cwd: "context", parentPath: "", items: deleted ? [] : [{
        name: "spec.txt", relativePath: "context/spec.txt", kind: "file", sizeBytes: 5,
        createdAt: null, modifiedAt: null, note: "Reference"
      }]
    }));
    api.post.mockImplementation(async () => {
      deleted = true;
      return { deletedCount: 1, deletedPaths: ["context/spec.txt"] };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function removeFile() {
    await act(async () => root.render(<ProjectContextPage />));
    await act(async () => container.querySelector<HTMLElement>(".file-row")!.click());
    const remove = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Remove")!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.click());
  }

  it("removes the row and refreshes after a successful deletion", async () => {
    await removeFile();
    expect(api.post).toHaveBeenCalledWith("/api/projects/project-1/files/delete", { paths: ["context/spec.txt"] });
    expect(container.querySelector(".file-row")).toBeNull();
    expect(container.textContent).toContain("Folder is empty");
    expect(setFlash).toHaveBeenCalledWith({ tone: "success", text: "Removed 1 item from context." });
  });

  it("removes the confirmed deleted row while note cleanup is still pending", async () => {
    let finish!: () => void;
    patchProject.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await removeFile();
    expect(patchProject).toHaveBeenCalled();
    expect(container.querySelector(".file-row")).toBeNull();
    await act(async () => finish());
  });

  it("refreshes and preserves the error when note cleanup fails after deletion", async () => {
    patchProject.mockRejectedValueOnce(new Error("Note cleanup failed"));
    await removeFile();
    expect(container.querySelector(".file-row")).toBeNull();
    expect(container.textContent).toContain("Note cleanup failed");
    expect(setFlash).not.toHaveBeenCalled();
  });

  it("refreshes when the server deletes the file but fails before replying successfully", async () => {
    api.post.mockImplementationOnce(async () => {
      deleted = true;
      throw new Error("Storage accounting failed");
    });
    await removeFile();
    expect(container.querySelector(".file-row")).toBeNull();
    expect(container.textContent).toContain("Storage accounting failed");
  });

  it("retains the file when deletion itself fails", async () => {
    api.post.mockRejectedValueOnce(new Error("Permission denied"));
    await removeFile();
    expect(container.querySelector(".file-row")?.textContent).toContain("spec.txt");
    expect(container.textContent).toContain("Permission denied");
  });
});
