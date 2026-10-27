import { describe, expect, it } from "vitest";
import { injectCanvasFrameRuntime } from "./canvas-frame-runtime.mjs";
import { parseCanvasFrameMessage } from "./canvas-frame.js";

function runtimeIndex(html: string): number {
  return html.indexOf("<script data-meowbert-canvas-runtime>");
}

describe("injectCanvasFrameRuntime", () => {
  it("runs before every page script", () => {
    const html = injectCanvasFrameRuntime("<!doctype html><html><head><script src=\"app.js\"></script></head><body></body></html>");
    expect(runtimeIndex(html)).toBeGreaterThan(html.indexOf("<head>"));
    expect(runtimeIndex(html)).toBeLessThan(html.indexOf("app.js"));
  });

  it("handles documents without a head and fragments", () => {
    expect(runtimeIndex(injectCanvasFrameRuntime("<html lang=\"en\"><body>x</body></html>"))).toBe("<html lang=\"en\">".length);
    expect(runtimeIndex(injectCanvasFrameRuntime("<header>x</header>"))).toBe(0);
  });

  it("keeps the runtime from closing its own script tag", () => {
    const html = injectCanvasFrameRuntime("<head></head>");
    const start = runtimeIndex(html);
    expect(html.indexOf("</script>", start)).toBe(html.lastIndexOf("</script>"));
  });
});

describe("parseCanvasFrameMessage", () => {
  it("validates and bounds element context instead of accepting arbitrary frame data", () => {
    const message = parseCanvasFrameMessage({ source: "meowbert-canvas", type: "selection", element: {
      tagName: "button", selector: "#buy", text: "x".repeat(2000),
      attributes: { id: "buy", onclick: "run()", value: "private", class: 4 }, screenLabel: "Checkout"
    } });
    expect(message).toEqual({ type: "selection", element: {
      tagName: "button", selector: "#buy", text: "x".repeat(1500), attributes: { id: "buy" }, screenLabel: "Checkout"
    } });
    expect(parseCanvasFrameMessage({ source: "meowbert-canvas", type: "selection", element: {} })).toBeNull();
    expect(parseCanvasFrameMessage({ source: "meowbert-canvas", type: "selection", element: null }))
      .toEqual({ type: "selection", element: null });
  });

  it("ignores messages that are not from the runtime", () => {
    expect(parseCanvasFrameMessage({ type: "run", prompt: "go" })).toBeNull();
    expect(parseCanvasFrameMessage({ source: "meowbert-canvas", type: "run", prompt: "  " })).toBeNull();
  });

  it("normalizes runtime errors", () => {
    expect(parseCanvasFrameMessage({ source: "meowbert-canvas", type: "error", error: { kind: "odd", message: "boom", line: 3 } }))
      .toEqual({ type: "error", error: { kind: "script", message: "boom", source: null, line: 3 } });
  });
});

describe("injected runtime", () => {
  it("does not shift the line numbers of the page's own scripts", () => {
    const page = "<!doctype html><html><head><title>x</title></head>\n<body>\n<script>boom()</script>";
    const injected = injectCanvasFrameRuntime(page);
    expect(injected.split("\n").length).toBe(page.split("\n").length);
  });

  it("stays valid JavaScript on one line", () => {
    const injected = injectCanvasFrameRuntime("<head></head>");
    const source = /<script data-meowbert-canvas-runtime>([\s\S]*?)<\/script>/.exec(injected)?.[1] ?? "";
    expect(() => new Function(source)).not.toThrow();
  });
});
