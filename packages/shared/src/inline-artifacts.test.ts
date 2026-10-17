import { describe, expect, it } from "vitest";
import { parseInlineArtifact, serializeInlineArtifact } from "./inline-artifacts.js";

describe("inline-artifacts", () => {
  it("parses stringified inline artifact payloads", () => {
    expect(
      parseInlineArtifact(
        JSON.stringify({
          ok: true,
          inline_artifact: {
            type: "html",
            relative_path: "/reports/summary.html",
            title: "Summary",
            description: "Visual summary",
            width: 820,
            height: 540
          }
        })
      )
    ).toEqual({
      type: "html",
      relativePath: "reports/summary.html",
      canvasId: null,
      display: "inline",
      title: "Summary",
      description: "Visual summary",
      width: 820,
      height: 540
    });
  });

  it("serializes normalized artifacts back to task content metadata", () => {
    expect(
      serializeInlineArtifact({
        type: "html",
        relativePath: "reports/summary.html",
        canvasId: null,
        display: "inline",
        title: "Summary",
        description: null,
        width: 820,
        height: 540
      })
    ).toEqual({
      type: "html",
      relative_path: "reports/summary.html",
      title: "Summary",
      width: 820,
      height: 540
    });
  });

  it("round-trips project canvas artifacts shown in the panel", () => {
    const artifact = parseInlineArtifact({
      inline_artifact: { type: "html", relative_path: "dist/index.html", canvas_id: "canvas-1", display: "panel" }
    });
    expect(artifact).toMatchObject({ canvasId: "canvas-1", display: "panel", relativePath: "dist/index.html" });
    expect(parseInlineArtifact(serializeInlineArtifact(artifact!))).toEqual(artifact);
  });

  it("accepts image and mermaid artifacts", () => {
    expect(parseInlineArtifact({ type: "image", relative_path: "figures/flow.png" })?.type).toBe("image");
    expect(parseInlineArtifact({ type: "mermaid", relative_path: "diagrams/sequence.mmd" })?.type).toBe("mermaid");
  });
});
