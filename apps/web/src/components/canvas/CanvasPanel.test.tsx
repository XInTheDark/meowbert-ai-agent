/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasPanel } from "./CanvasPanel";
import type { CanvasHost } from "./CanvasHostContext";
import type { CanvasView } from "./canvasViews";

describe("CanvasPanel selection", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;
  const sendPrompt = vi.fn();
  const host: CanvasHost = { taskId: "task", resolveSource: (view) => ({ src: `https://example.test/${view.relativePath}`, srcKey: view.relativePath }),
    reloadTokenFor: () => 0, sendPrompt };
  const view: CanvasView = { type: "html", relativePath: "checkout.html", canvasId: null, title: "Checkout", display: "panel", height: null };
  const element = { tagName: "button", selector: "#buy", text: "Buy now", attributes: { id: "buy" }, screenLabel: null };

  beforeEach(() => {
    sendPrompt.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  async function render(activeView = view, currentHost = host) {
    await act(async () => root.render(<CanvasPanel host={currentHost} views={[view, activeView]} activeView={activeView}
      onSelect={() => {}} onClose={() => {}} />));
  }
  async function click(label: string) {
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  }
  async function pick() {
    const frame = container.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow,
      data: { source: "meowbert-canvas", type: "selection", element } })));
  }

  it("sends the instruction and selected source context only after explicit submission", async () => {
    await render();
    await click("Select an element");
    await pick();
    expect(sendPrompt).not.toHaveBeenCalled();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Ask about selected element"]')!;
    await act(async () => Simulate.change(input, { target: { value: "Make this shorter" } } as unknown as Parameters<typeof Simulate.change>[1]));
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt.mock.calls[0][0]).toContain("Make this shorter");
    expect(sendPrompt.mock.calls[0][0]).toContain("checkout.html");
    expect(sendPrompt.mock.calls[0][0]).toContain("#buy");
    expect(container.querySelector("form")).toBeNull();
  });

  it("clears context across canvas switches and reloads", async () => {
    await render();
    await click("Select an element");
    await pick();
    await render({ ...view, relativePath: "other.html" });
    await render();
    expect(container.querySelector("form")).toBeNull();
    await click("Select an element");
    await pick();
    await click("Reload");
    expect(container.querySelector("form")).toBeNull();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("does not expose selection on read-only canvases", async () => {
    await render(view, { ...host, sendPrompt: undefined });
    expect(container.querySelector('button[aria-label="Select an element"]')).toBeNull();
  });
});
