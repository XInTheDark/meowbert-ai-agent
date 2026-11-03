import { describe, expect, it } from "vitest";
import { buildCitationToken, citationTextToHtml, parseCitationSegments } from "./citationToken";

describe("citation tokens", () => {
  it.each([
    { label: "report.pdf", path: "inputs/report.pdf" },
    { label: "Screenshot 2026-11-03 at 10.png", path: "inputs/Screenshot 2026-11-03 at 10.png" },
    { label: "notes [final] (2).md", path: "inputs/notes [final] (2).md" }
  ])("reads back $label from its own token", (citation) => {
    expect(parseCitationSegments(`see ${buildCitationToken(citation)} now`)).toEqual([
      { kind: "text", text: "see " },
      { kind: "citation", citation },
      { kind: "text", text: " now" }
    ]);
  });

  it("leaves ordinary links as text", () => {
    const text = "[docs](https://example.com) and [up](../inputs/x.md)";
    expect(parseCitationSegments(text)).toEqual([{ kind: "text", text }]);
  });

  it("recognizes project files the caller knows about", () => {
    const segments = parseCitationSegments("[a.md](docs/a.md)", (path) => path === "docs/a.md");
    expect(segments).toEqual([{ kind: "citation", citation: { label: "a.md", path: "docs/a.md" } }]);
  });

  it("copies citations as links and escapes everything else", () => {
    expect(citationTextToHtml("<b>\n[a.pdf](inputs/a.pdf)")).toBe("&lt;b&gt;<br><a href=\"inputs/a.pdf\">a.pdf</a>");
  });
});
