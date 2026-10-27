/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CANVAS_SELECTION_RUNTIME_SOURCE } from "../../../../../packages/shared/src/canvas-selection-runtime.mjs";

describe("canvas selection runtime", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

  function start() {
    document.body.innerHTML = '<section data-label="Checkout"><button id="buy">Buy now</button><button>Cancel</button></section>';
    const postMessage = vi.fn();
    const host = { postMessage } as unknown as Window;
    const listeners: Array<[string, EventListener, boolean | AddEventListenerOptions | undefined]> = [];
    const add = window.addEventListener.bind(window);
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", { value: host, configurable: true });
    const spy = vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      listeners.push([type, listener as EventListener, options]);
      add(type, listener, options);
    });
    window.eval(CANVAS_SELECTION_RUNTIME_SOURCE);
    spy.mockRestore();
    cleanups.push(() => {
      listeners.forEach(([type, listener, options]) => window.removeEventListener(type, listener, options));
      Object.defineProperty(window, "parent", { value: originalParent, configurable: true });
      document.body.innerHTML = "";
      document.querySelector("[data-meowbert-selection-overlay]")?.remove();
    });
    const setMode = (enabled: boolean, source: Window = host) => window.dispatchEvent(new MessageEvent("message", {
      source, data: { source: "meowbert-canvas", type: "selection-mode", enabled }
    }));
    return { postMessage, setMode, button: document.querySelector("button")! };
  }

  it("leaves normal interactions alone and intercepts them only in selection mode", () => {
    const { button, setMode, postMessage } = start();
    const click = vi.fn();
    button.addEventListener("click", click);
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
    setMode(true);
    button.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "selection", element: {
      tagName: "button", selector: "button#buy", text: "Buy now", attributes: { id: "buy" }, screenLabel: "Checkout"
    } }), "*");
    expect(document.querySelector<HTMLElement>("[data-meowbert-selection-overlay]")?.style.pointerEvents).toBe("none");
  });

  it("ignores other windows and Escape restores page interactions", () => {
    const { button, setMode, postMessage } = start();
    const click = vi.fn();
    button.addEventListener("click", click);
    setMode(true, window);
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
    setMode(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    button.click();
    expect(click).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledWith({ source: "meowbert-canvas", type: "selection", element: null }, "*");
  });

  it("uses an unambiguous sibling path and bounds text without reading form values", () => {
    const { setMode, postMessage } = start();
    const button = document.querySelectorAll("button")[1];
    button.textContent = "x".repeat(2000);
    setMode(true);
    button.click();
    const selected = postMessage.mock.calls[0][0].element;
    expect(document.querySelector(selected.selector)).toBe(button);
    expect(selected.text).toHaveLength(1500);
  });
});
