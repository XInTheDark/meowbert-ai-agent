import { describe, expect, it } from "vitest";
import { getInlineFilePreviewKind } from "./filePreviewKinds";

describe("getInlineFilePreviewKind", () => {
  it("detects image files case-insensitively", () => {
    expect(getInlineFilePreviewKind("screenshots/hero.PNG")).toBe("image");
    expect(getInlineFilePreviewKind("designs/icon.SvG")).toBe("image");
  });

  it("detects pdf files", () => {
    expect(getInlineFilePreviewKind("docs/spec.pdf")).toBe("pdf");
  });

  it("ignores unsupported or extensionless files", () => {
    expect(getInlineFilePreviewKind("notes/readme.md")).toBeNull();
    expect(getInlineFilePreviewKind("LICENSE")).toBeNull();
    expect(getInlineFilePreviewKind("archive.")).toBeNull();
  });
});
