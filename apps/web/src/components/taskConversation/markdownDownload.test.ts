import { afterEach, describe, expect, it } from "vitest";
import { setRuntimeApiBaseUrl } from "../../lib/runtime";
import { resolveMarkdownDownloadFilename, resolveRuntimeFileDownloadPath, resolveTrustedMarkdownDownloadUrl } from "./markdownDownload";

afterEach(() => {
  setRuntimeApiBaseUrl(null);
});

describe("resolveTrustedMarkdownDownloadUrl", () => {
  it("accepts only the configured API origin and download routes", () => {
    setRuntimeApiBaseUrl("https://api.example");

    expect(resolveTrustedMarkdownDownloadUrl("/api/projects/project-1/files/download?path=report.pdf"))
      .toBe("https://api.example/api/projects/project-1/files/download?path=report.pdf");
    expect(resolveTrustedMarkdownDownloadUrl("https://api.example/api/workspaces/workspace-1/files/download/batch?paths=report.pdf"))
      .toBe("https://api.example/api/workspaces/workspace-1/files/download/batch?paths=report.pdf");
  });

  it("rejects similarly named routes and every other origin", () => {
    setRuntimeApiBaseUrl("https://api.example");

    expect(resolveTrustedMarkdownDownloadUrl("/api/projects/project-1/files/download-anything")).toBeNull();
    expect(resolveTrustedMarkdownDownloadUrl("/api/projects/project-1/files/content?path=report.pdf")).toBeNull();
    expect(resolveTrustedMarkdownDownloadUrl("https://attacker.example/api/projects/project-1/files/download")).toBeNull();
    expect(resolveTrustedMarkdownDownloadUrl("//attacker.example/api/projects/project-1/files/download")).toBeNull();
  });
});

describe("resolveRuntimeFileDownloadPath", () => {
  const projectId = "594cd7a3-f81d-434e-9088-5987d58140d5";
  const runtimePath = `/app/runtime/storage/onedrive-main/workspaces/8b158122-6a8b-4814-89d8-5c5a23d84056/environments/${projectId}/root/.meowbert/task-runs/run-1/five-original-sf-stories.md`;

  it("maps a project filesystem path to the authorized download route", () => {
    expect(resolveRuntimeFileDownloadPath(runtimePath))
      .toBe(`/api/projects/${projectId}/files/download?path=.meowbert%2Ftask-runs%2Frun-1%2Ffive-original-sf-stories.md`);
    expect(resolveRuntimeFileDownloadPath(`/app/runtime/environments/${projectId}/root/reports/annual%20report.pdf`))
      .toBe(`/api/projects/${projectId}/files/download?path=reports%2Fannual%20report.pdf`);
  });

  it("does not reinterpret external, unrelated, or escaping URLs as project files", () => {
    expect(resolveRuntimeFileDownloadPath(`https://attacker.example${runtimePath}`)).toBeNull();
    expect(resolveRuntimeFileDownloadPath(`/app/runtime/storage/onedrive-main/workspaces/one/files/${projectId}/report.pdf`)).toBeNull();
    expect(resolveRuntimeFileDownloadPath(`/app/runtime/environments/${projectId}/root/../private.txt`)).toBeNull();
    expect(resolveRuntimeFileDownloadPath(`${runtimePath}?path=another.txt`)).toBeNull();
  });
});

describe("resolveMarkdownDownloadFilename", () => {
  it("extracts the actual file name from the path query parameter", () => {
    expect(resolveMarkdownDownloadFilename("/api/projects/project-1/files/download?path=classroom_solution.zip"))
      .toBe("classroom_solution.zip");
    expect(resolveMarkdownDownloadFilename("/api/projects/project-1/files/download?path=.meowbert/task-runs/run-1/report.pdf"))
      .toBe("report.pdf");
    expect(resolveMarkdownDownloadFilename("http://localhost:4000/api/projects/project-1/files/download?path=data%20export.csv"))
      .toBe("data export.csv");
  });

  it("prioritizes the actual file name over markdown link text even when the link text is a URL or descriptive text", () => {
    expect(resolveMarkdownDownloadFilename(
      "/api/projects/project-1/files/download?path=classroom_solution.zip",
      "/api/projects/project-1/files/download?path=classroom_solution.zip"
    )).toBe("classroom_solution.zip");

    expect(resolveMarkdownDownloadFilename(
      "http://localhost:4000/api/projects/project-1/files/download?path=report.pdf",
      "http://localhost:4000/api/projects/project-1/files/download?path=report.pdf"
    )).toBe("report.pdf");

    expect(resolveMarkdownDownloadFilename(
      "/api/projects/project-1/files/download?path=report.pdf",
      "Click here to download"
    )).toBe("report.pdf");
  });

  it("returns selected-files.zip for batch download endpoints", () => {
    expect(resolveMarkdownDownloadFilename("/api/projects/project-1/files/download/batch?path=a.txt&path=b.txt"))
      .toBe("selected-files.zip");
  });

  it("falls back to valid filename text or default if path query parameter is missing", () => {
    expect(resolveMarkdownDownloadFilename("/api/projects/project-1/files/download", "custom_file.txt"))
      .toBe("custom_file.txt");
    expect(resolveMarkdownDownloadFilename("/api/projects/project-1/files/download", "https://attacker.example/bad"))
      .toBe("download");
    expect(resolveMarkdownDownloadFilename("/api/projects/project-1/files/download", "/some/path/bad"))
      .toBe("download");
    expect(resolveMarkdownDownloadFilename("/api/projects/project-1/files/download"))
      .toBe("download");
  });
});
