import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { injectCanvasFrameRuntime } from "../../../../../packages/shared/src/canvas-frame-runtime.mjs";

const documentSource = readFileSync(new URL("../../../../../skills/html-canvas/assets/templates/meowbert-document.js", import.meta.url), "utf8");

describe("canvas document initialization", () => {
  it.each([true, false])("applies fit=%s before restoring scroll and reports its current file URL", async (fit) => {
    const postMessage = vi.fn();
    const scroll = vi.fn();
    const href = "https://example.test/preview/ticket/pricing.html";
    const html = `<html><head><script>${documentSource}</script></head><body><meowbert-document>Content</meowbert-document></body></html>`;
    const dom = new JSDOM(injectCanvasFrameRuntime(html), {
      url: href, runScripts: "dangerously", pretendToBeVisual: true,
      beforeParse(window) {
        window.name = `meowbert-canvas:${JSON.stringify({ documentFit: fit, scroll: { x: 0, y: 2000 } })}`;
        Object.defineProperty(window, "parent", { value: { postMessage } });
        Object.defineProperty(window, "innerWidth", { value: 350 });
        window.scrollTo = (x, y) => scroll(x, y, window.document.querySelector("meowbert-document")?.style.zoom);
      }
    });
    try {
      await new Promise((resolve) => dom.window.addEventListener("load", () => resolve()));
      expect(scroll).toHaveBeenCalledWith(0, 2000, fit ? String((350 - 32) / 794) : "1");
      expect(postMessage).toHaveBeenCalledWith({ source: "meowbert-canvas", type: "location", href }, "*");
      dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: dom.window.parent,
        data: { source: "meowbert-canvas", type: "document-view", fit: !fit } }));
      expect(JSON.parse(dom.window.name.slice("meowbert-canvas:".length)).documentFit).toBe(!fit);
      expect(dom.window.document.querySelector("meowbert-document")?.style.zoom).toBe(fit ? "1" : String((350 - 32) / 794));
    } finally { dom.window.close(); }
  });
});
