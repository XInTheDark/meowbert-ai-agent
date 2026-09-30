import { describe, expect, it } from "vitest";
import { normalizeSkillToolArguments } from "./skill-tool-paths.js";

describe("normalizeSkillToolArguments", () => {
  it("resolves top-level relative path fields from the tracked shell cwd", () => {
    expect(normalizeSkillToolArguments({
      input_path: "slides/01-cover.html",
      output_dir: "./out"
    }, "/tmp/task/work")).toEqual({
      input_path: "/tmp/task/work/slides/01-cover.html",
      output_dir: "/tmp/task/work/out"
    });
  });

  it("resolves nested path fields inside arrays and objects", () => {
    expect(normalizeSkillToolArguments({
      slides: [
        {
          title: "Roadmap",
          visual_svg_path: "../assets/roadmap.svg"
        }
      ]
    }, "/tmp/task/decks/q2")).toEqual({
      slides: [
        {
          title: "Roadmap",
          visual_svg_path: "/tmp/task/decks/assets/roadmap.svg"
        }
      ]
    });
  });

  it("leaves absolute paths, urls, and non-path fields unchanged", () => {
    expect(normalizeSkillToolArguments({
      template_path: "/tmp/task/template.pptx",
      output_path: "https://example.test/template.pptx",
      html: "<!doctype html><html></html>",
      note: "slides/01-cover.html"
    }, "/tmp/task")).toEqual({
      template_path: "/tmp/task/template.pptx",
      output_path: "https://example.test/template.pptx",
      html: "<!doctype html><html></html>",
      note: "slides/01-cover.html"
    });
  });

  it("resolves arrays of relative paths", () => {
    expect(normalizeSkillToolArguments({
      source_paths: ["./a.docx", "nested/b.docx", "/tmp/task/c.docx"]
    }, "/tmp/task/files")).toEqual({
      source_paths: [
        "/tmp/task/files/a.docx",
        "/tmp/task/files/nested/b.docx",
        "/tmp/task/c.docx"
      ]
    });
  });

  it("resolves filename and file_name fields while leaving name fields untouched", () => {
    expect(normalizeSkillToolArguments({
      filename: "screenshot.png",
      file_name: "nested/report.pdf",
      output_filename: "final.png",
      name: "My Project Report",
      user_name: "admin"
    }, "/tmp/task/cwd")).toEqual({
      filename: "/tmp/task/cwd/screenshot.png",
      file_name: "/tmp/task/cwd/nested/report.pdf",
      output_filename: "/tmp/task/cwd/final.png",
      name: "My Project Report",
      user_name: "admin"
    });
  });
});
