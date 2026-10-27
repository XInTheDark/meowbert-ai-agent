/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasFrame } from "./CanvasFrame";

describe("CanvasFrame", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(props: Partial<Parameters<typeof CanvasFrame>[0]> = {}) {
    await act(async () => {
      root.render(
        <CanvasFrame
          src="https://example.test/chart.html"
          srcKey="task:chart.html"
          title="Chart"
          storageKey="task:test:chart.html"
          sizing={{ mode: "auto", minHeight: 120, maxHeight: 900 }}
          {...props}
        />
      );
    });
    return container.querySelector("iframe")!;
  }

  async function postFromFrame(frame: HTMLIFrameElement, data: Record<string, unknown>, source: Window | null = frame.contentWindow) {
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { source: "meowbert-canvas", ...data }, source }));
    });
  }

  it("sizes itself to the height the page reports and ignores other windows", async () => {
    const frame = await render();
    const wrapper = container.querySelector<HTMLElement>(".canvas-frame")!;
    expect(wrapper.style.height).toBe("120px");

    await postFromFrame(frame, { type: "resize", height: 480 });
    expect(wrapper.style.height).toBe("480px");

    await postFromFrame(frame, { type: "resize", height: 700 }, window);
    expect(wrapper.style.height).toBe("480px");
  });

  it("accepts selections only from its frame while the user enabled selection", async () => {
    const onElementSelect = vi.fn();
    const frame = await render({ onElementSelect });
    const element = { tagName: "button", selector: "#buy", text: "Buy", attributes: {}, screenLabel: null };
    await postFromFrame(frame, { type: "selection", element });
    expect(onElementSelect).not.toHaveBeenCalled();
    await render({ onElementSelect, selectionEnabled: true });
    await postFromFrame(frame, { type: "selection", element }, window);
    expect(onElementSelect).not.toHaveBeenCalled();
    await postFromFrame(frame, { type: "selection", element });
    expect(onElementSelect).toHaveBeenCalledWith(element);
    await postFromFrame(frame, { type: "selection", element: null });
    expect(onElementSelect).toHaveBeenLastCalledWith(null);
  });

  it("says the page could not be loaded when it never starts the canvas runtime", async () => {
    vi.useFakeTimers();
    const frame = await render();
    await act(async () => {
      frame.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(3000);
    });

    expect(container.textContent).toContain("This page couldn't be loaded");
  });

  it("restores scroll on reload without carrying it to another document", async () => {
    const frame = await render();
    await postFromFrame(frame, { type: "scroll", x: 0, y: 640 });
    const reloaded = await render({ reloadToken: 1 });
    expect(JSON.parse(reloaded.name.slice("meowbert-canvas:".length)).scroll).toEqual({ x: 0, y: 640 });
    const other = await render({ srcKey: "other.html", reloadToken: 1 });
    expect(JSON.parse(other.name.slice("meowbert-canvas:".length)).scroll).toBeUndefined();
  });

  it("initializes a reload with the selected zoom mode and its saved scroll", async () => {
    const frame = await render();
    const initialName = frame.name;
    await render({ documentFit: false });
    expect(frame.name).toBe(initialName);
    await postFromFrame(frame, { type: "scroll", x: 0, y: 2000 });
    const reloaded = await render({ reloadToken: 1, documentFit: false });
    expect(JSON.parse(reloaded.name.slice("meowbert-canvas:".length))).toMatchObject({
      documentFit: false, scroll: { x: 0, y: 2000 }
    });
  });

  it("sends a page's request only after the user confirms it", async () => {
    const onRunRequest = vi.fn();
    const frame = await render({ onRunRequest });
    await postFromFrame(frame, { type: "run", prompt: "Check my answer", title: null });

    expect(container.textContent).toContain("Check my answer");
    expect(onRunRequest).not.toHaveBeenCalled();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Send")?.click();
    });
    expect(onRunRequest).toHaveBeenCalledWith({ prompt: "Check my answer", title: null });
  });
});
