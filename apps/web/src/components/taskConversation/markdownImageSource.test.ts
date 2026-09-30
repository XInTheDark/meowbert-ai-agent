import { describe, expect, it } from "vitest";
import { resolveMarkdownImageSource } from "./markdownImageSource";

const buildInlineFileUrl = (relativePath: string) => `https://api.example/api/tasks/task-1/inline-files/ticket-1/${relativePath}`;

describe("resolveMarkdownImageSource", () => {
  it("serves bare relative paths from the task folder", () => {
    expect(resolveMarkdownImageSource("weekly_summary.png", buildInlineFileUrl)).toEqual({
      kind: "task-file",
      src: "https://api.example/api/tasks/task-1/inline-files/ticket-1/weekly_summary.png"
    });
    expect(resolveMarkdownImageSource("./charts/My%20Chart.png?v=2", buildInlineFileUrl)).toEqual({
      kind: "task-file",
      src: "https://api.example/api/tasks/task-1/inline-files/ticket-1/charts/My Chart.png"
    });
  });

  it("leaves absolute, external and inline sources untouched", () => {
    for (const src of [
      "https://example.com/chart.png",
      "//cdn.example/chart.png",
      "/api/projects/project-1/files/download?path=chart.png",
      "data:image/png;base64,AAAA",
      "#anchor",
      undefined
    ]) {
      expect(resolveMarkdownImageSource(src, buildInlineFileUrl)).toEqual({ kind: "external", src });
    }
  });

  it("refuses paths that climb out of the task folder", () => {
    expect(resolveMarkdownImageSource("../other-task/secret.png", buildInlineFileUrl))
      .toEqual({ kind: "external", src: "../other-task/secret.png" });
    expect(resolveMarkdownImageSource("charts/%2E%2E/%2E%2E/secret.png", buildInlineFileUrl))
      .toEqual({ kind: "external", src: "charts/%2E%2E/%2E%2E/secret.png" });
  });

  it("waits for the inline file ticket instead of requesting the page-relative URL", () => {
    expect(resolveMarkdownImageSource("weekly_summary.png", () => null)).toEqual({ kind: "task-file", src: null });
  });

  it("keeps the original source outside a task conversation", () => {
    expect(resolveMarkdownImageSource("weekly_summary.png", null)).toEqual({ kind: "external", src: "weekly_summary.png" });
  });
});
