/** @vitest-environment jsdom */

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import type { TaskAttachment } from "../lib/types";
import { buildTaskInputAttachmentPath } from "../task/taskFileDestinations";
import { useFileUpload } from "./useFileUpload";

function createUploadFile(name: string, webkitRelativePath?: string): File {
  const file = new File(["content"], name, { type: "text/plain" });

  if (webkitRelativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: webkitRelativePath
    });
  }

  return file;
}

describe("useFileUpload", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it("resolves to each file's attachment in order, with null for failures", async () => {
    const postForm = vi.fn(async (_path: string, formData: FormData) => {
      const file = formData.get("file") as File;
      if (file.name === "bad.txt") throw new Error("nope");
      return { file: { name: file.name, relativePath: `inputs/${file.name}`, sizeBytes: file.size, createdAt: null, modifiedAt: null } };
    });
    let uploadFiles: ReturnType<typeof useFileUpload>["uploadFiles"] = async () => [];

    function Harness() {
      uploadFiles = useFileUpload({ postForm } as unknown as ApiClient, "11111111-1111-4111-8111-111111111111", { destinationPath: "inputs" }).uploadFiles;
      return null;
    }

    await act(async () => {
      root?.render(<Harness />);
    });

    let results: Array<TaskAttachment | null> = [];
    await act(async () => {
      results = await uploadFiles([createUploadFile("bad.txt"), createUploadFile("good.txt")]);
    });

    expect(results[0]).toBeNull();
    expect(results[1]?.relativePath).toBe("inputs/good.txt");
  });

  it("preserves folder paths when uploading task input folders", async () => {
    const postForm = vi.fn(async (path: string, formData: FormData) => {
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new Error("Expected file upload");
      }

      const requestUrl = new URL(path, "https://example.test");
      const targetPath = requestUrl.searchParams.get("path") ?? "";

      return {
        file: {
          name: file.name,
          relativePath: `${targetPath}/${file.name}`,
          sizeBytes: file.size,
          createdAt: null,
          modifiedAt: null
        }
      };
    });
    const api = { postForm } as unknown as ApiClient;
    const destinationPath = ".meowbert/task-runs/task-1/inputs";
    let uploadFiles: ReturnType<typeof useFileUpload>["uploadFiles"] | null = null;
    let attachments: ReturnType<typeof useFileUpload>["attachments"] = [];

    function Harness() {
      const upload = useFileUpload(api, "11111111-1111-4111-8111-111111111111", {
        destinationPath,
        createDirectories: true,
        toAttachmentPath: (uploaded) => buildTaskInputAttachmentPath(destinationPath, uploaded.relativePath, uploaded.name)
      });

      uploadFiles = upload.uploadFiles;
      useEffect(() => {
        attachments = upload.attachments;
      }, [upload.attachments]);

      return null;
    }

    await act(async () => {
      root?.render(<Harness />);
    });

    await act(async () => {
      await uploadFiles?.([
        createUploadFile("slides.pdf", "course/week-1/slides.pdf"),
        createUploadFile("notes.pdf", "course/week-1/notes.pdf")
      ]);
    });

    expect(postForm.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/11111111-1111-4111-8111-111111111111/files/upload?path=.meowbert%2Ftask-runs%2Ftask-1%2Finputs%2Fcourse%2Fweek-1&createDirectories=true",
      "/api/projects/11111111-1111-4111-8111-111111111111/files/upload?path=.meowbert%2Ftask-runs%2Ftask-1%2Finputs%2Fcourse%2Fweek-1&createDirectories=true"
    ]);
    expect(attachments.map((attachment) => attachment.relativePath)).toEqual([
      "inputs/course/week-1/slides.pdf",
      "inputs/course/week-1/notes.pdf"
    ]);
  });
});
