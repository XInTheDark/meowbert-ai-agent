/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { resolveCanvasDocumentPath } from "./canvasDocumentPath";

describe("canvas document paths", () => {
  const src = "https://example.test/preview/ticket/site/index.html";
  it("preserves nested paths and decodes filenames without query or fragment suffixes", () => {
    expect(resolveCanvasDocumentPath(src, "site/index.html", "https://example.test/preview/ticket/pages/pricing%20plan.html?plan=pro#details"))
      .toBe("pages/pricing plan.html");
  });
  it.each([
    "https://other.test/preview/ticket/pricing.html",
    "https://example.test/preview/another-ticket/pricing.html",
    "https://example.test/preview/ticket-elsewhere/pricing.html",
    "https://example.test/preview/ticket/pages%2Fpricing.html",
    "https://example.test/preview/ticket/pages%5Cpricing.html",
    "https://example.test/preview/ticket/pricing%00.html",
    "https://example.test/preview/ticket/%invalid.html",
    "not a URL"
  ])("rejects a document URL outside the preview path contract: %s", (href) => {
    expect(resolveCanvasDocumentPath(src, "site/index.html", href)).toBeNull();
  });
  it("handles local desktop preview URLs within the same ticket and task", () => {
    const base = "meowbert-workspace://files/device-ticket/api/tasks/task/inline-files/device/";
    expect(resolveCanvasDocumentPath(`${base}index.html`, "index.html", `${base}pricing.html`)).toBe("pricing.html");
    expect(resolveCanvasDocumentPath(`${base}index.html`, "index.html", `${base.replace("device-ticket", "other-ticket")}pricing.html`)).toBeNull();
  });
});
