/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { ProjectCanvasSummary, TaskArtifact } from "../../../lib/types";
import { TaskDetailArtifactsPane } from "./TaskDetailArtifactsPane";

vi.mock("../../../lib/projectCanvases", () => ({
  fetchProjectCanvasPreviewTicket: vi.fn(async () => ({ ticket: "preview-ticket", expiresAt: "" })),
  buildProjectCanvasPreviewUrl: vi.fn(() => "/canvas-preview")
}));

describe("TaskDetailArtifactsPane", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("loads the selected artifact through the project file preview endpoint", async () => {
    const artifact: TaskArtifact = {
      id: "artifact-1",
      kind: "artifact",
      relative_path: "reports/summary.txt",
      size_bytes: 12,
      mime_type: "text/plain",
      created_at: "2026-07-21T00:00:00.000Z"
    };
    const get = vi.fn().mockResolvedValue({
      relativePath: ".meowbert/task-runs/task-1/reports/summary.txt",
      sizeBytes: 12,
      truncated: false,
      encoding: "utf-8",
      text: "Artifact contents"
    });
    const api = { get } as unknown as ApiClient;
    const onDownloadArtifact = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskDetailArtifactsPane
          api={api}
          token="token-1"
          projectId="project-1"
          taskRootPath=".meowbert/task-runs/task-1"
          artifacts={[artifact]}
          canvases={[]}
          onDownloadArtifact={onDownloadArtifact}
          onOpenCanvas={vi.fn()}
        />
      );
    });

    expect(get).toHaveBeenCalledWith(
      "/api/projects/project-1/files/content?path=.meowbert%2Ftask-runs%2Ftask-1%2Freports%2Fsummary.txt"
    );
    expect(container.textContent).toContain("Artifact contents");

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[aria-label="Download summary.txt"]')?.click();
    });
    expect(onDownloadArtifact).toHaveBeenCalledWith("reports/summary.txt");
  });

  it("shows an associated Interactive Canvas as a previewable artifact", async () => {
    const canvas: ProjectCanvasSummary = {
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
    };
    const onOpenCanvas = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskDetailArtifactsPane
          api={{ get: vi.fn() } as unknown as ApiClient}
          token="token-1"
          projectId="project-1"
          taskRootPath=".meowbert/task-runs/task-1"
          artifacts={[]}
          canvases={[canvas]}
          onDownloadArtifact={vi.fn()}
          onOpenCanvas={onOpenCanvas}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Quadratics Lab");
    expect(container.textContent).toContain("Interactive canvas");
    expect(container.querySelector<HTMLIFrameElement>('iframe[title="Quadratics Lab preview"]')?.src).toContain("/canvas-preview");

    await act(async () => {
      Array.from(container?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.includes("Open canvas"))
        ?.click();
    });
    expect(onOpenCanvas).toHaveBeenCalledWith("canvas-1");
  });

  it("shows spinning loader and disables download button when isDownloadingArtifact is true", async () => {
    const artifact: TaskArtifact = {
      id: "artifact-1",
      kind: "artifact",
      relative_path: "reports/summary.txt",
      size_bytes: 12,
      mime_type: "text/plain",
      created_at: "2026-07-21T00:00:00.000Z"
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TaskDetailArtifactsPane
          api={{ get: vi.fn().mockResolvedValue({ text: "" }) } as unknown as ApiClient}
          token="token-1"
          projectId="project-1"
          taskRootPath=".meowbert/task-runs/task-1"
          artifacts={[artifact]}
          canvases={[]}
          isDownloadingArtifact
          onDownloadArtifact={vi.fn()}
          onOpenCanvas={vi.fn()}
        />
      );
    });

    const downloadButton = container.querySelector<HTMLButtonElement>('button[aria-label="Preparing download"]');
    expect(downloadButton).not.toBeNull();
    expect(downloadButton?.disabled).toBe(true);
    expect(downloadButton?.querySelector("svg.spin")).not.toBeNull();
  });
});
