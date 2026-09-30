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

  it("accepts image and mermaid artifacts", () => {
    expect(parseInlineArtifact({ type: "image", relative_path: "figures/flow.png" })?.type).toBe("image");
    expect(parseInlineArtifact({ type: "mermaid", relative_path: "diagrams/sequence.mmd" })?.type).toBe("mermaid");
  });
});
