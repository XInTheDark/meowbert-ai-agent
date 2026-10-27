/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasPanel } from "./CanvasPanel";
import type { CanvasComment } from "@meowbert/shared";
import type { CanvasHost } from "./CanvasHostContext";
import type { CanvasView } from "./canvasViews";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

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
  async function pick(selected = element) {
    const frame = container.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow,
      data: { source: "meowbert-canvas", type: "selection", element: selected } })));
  }
  async function draft(body: string) {
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => Simulate.change(input, { target: { value: body } } as unknown as Parameters<typeof Simulate.change>[1]));
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

  it("switches to document fit controls only for metadata from the owning frame", async () => {
    await render();
    const frame = container.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: window,
      data: { source: "meowbert-canvas", type: "ready", kind: "document", blank: false } })));
    expect(container.querySelector('[aria-label="Document view"]')).toBeNull();
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow,
      data: { source: "meowbert-canvas", type: "ready", kind: "document", blank: false } })));
    expect(container.querySelector('[aria-label="Preview width"]')).toBeNull();
    expect(container.querySelector('[aria-label="Document view"]')?.textContent).toBe("Fit100%");
    await render({ ...view, relativePath: "site.html" });
    expect(container.querySelector('[aria-label="Preview width"]')).not.toBeNull();
  });

  it("saves feedback separately from sending it and restores comments after reopening", async () => {
    const comment = { id: "comment", relativePath: view.relativePath, element, body: "Make this shorter", resolved: false, createdAt: "2026-10-27T00:00:00Z" };
    const store = { list: vi.fn().mockResolvedValue([]), add: vi.fn().mockResolvedValue(comment),
      resolve: vi.fn().mockResolvedValue({ ...comment, resolved: true }) };
    const currentHost = { ...host, comments: store };
    await render(view, currentHost);
    await click("Comments");
    await click("Add comment");
    await pick();
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => Simulate.change(input, { target: { value: comment.body } } as unknown as Parameters<typeof Simulate.change>[1]));
    await click("Save comment");
    expect(store.add).toHaveBeenCalledWith(view, element, comment.body);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(comment.body);
    await click("Resolve comment");
    expect(store.resolve).toHaveBeenCalledWith(view, comment.id, true);
    expect(container.querySelector('[aria-label="Reopen comment"]')).not.toBeNull();
    store.list.mockResolvedValue([comment]);
    await render({ ...view, relativePath: "other.html" }, currentHost);
    await render(view, currentHost);
    expect(container.textContent).toContain(comment.body);
    await click("Ask Meowbert");
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt.mock.calls[0][0]).toContain("#buy");
  });

  it("starts commenting from the empty comments list, even on canvases that cannot send requests", async () => {
    const comment = { id: "comment", relativePath: view.relativePath, element, body: "Too loud", resolved: false, createdAt: "2026-10-27T00:00:00Z" };
    const store = { list: vi.fn().mockResolvedValue([]), add: vi.fn().mockResolvedValue(comment), resolve: vi.fn() };
    await render(view, { ...host, sendPrompt: undefined, comments: store });
    await click("Comments");
    await act(async () => container.querySelector<HTMLButtonElement>(".canvas-comments-empty")!.click());
    await pick();
    await draft(comment.body);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(store.add).toHaveBeenCalledWith(view, element, comment.body);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain(comment.body);
  });

  it("retains the draft and exposes errors when comment saving fails", async () => {
    const store = { list: vi.fn().mockResolvedValue([]), add: vi.fn().mockRejectedValue(new Error("Offline")), resolve: vi.fn() };
    await render(view, { ...host, comments: store });
    await click("Comments");
    await click("Add comment");
    await pick();
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => Simulate.change(input, { target: { value: "Keep this feedback" } } as unknown as Parameters<typeof Simulate.change>[1]));
    await click("Save comment");
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("Keep this feedback");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Offline");
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("keeps a newer selection and its draft when an earlier save finishes", async () => {
    const save = deferred<CanvasComment>();
    const store = { list: vi.fn().mockResolvedValue([]), add: vi.fn().mockReturnValue(save.promise), resolve: vi.fn() };
    await render(view, { ...host, comments: store });
    await click("Comments");
    await click("Add comment");
    await pick();
    await draft("Feedback for Buy");
    await click("Save comment");
    await pick({ ...element, selector: "#cancel", text: "Cancel", attributes: { id: "cancel" } });
    await draft("Unsaved feedback for Cancel");
    await act(async () => save.resolve({ id: "buy-comment", relativePath: view.relativePath, element, body: "Feedback for Buy",
      resolved: false, createdAt: "2026-10-27T00:00:00Z" }));
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("Unsaved feedback for Cancel");
    expect(container.querySelector(".canvas-selection-target")?.textContent).toBe("Cancel");
    expect(container.querySelector('input[aria-label="Comment on selected element"]')).not.toBeNull();
    expect(container.textContent).toContain("Feedback for Buy");
  });

  it.each([null, "project-canvas"])("scopes feedback to the navigated page for canvas %s", async (canvasId) => {
    const entry = { ...view, canvasId };
    const pricing = { ...entry, relativePath: "pages/pricing plan.html" };
    const comment = { id: "pricing-comment", relativePath: pricing.relativePath, element, body: "Clarify pricing",
      resolved: false, createdAt: "2026-10-27T00:00:00Z" };
    const store = { list: vi.fn().mockImplementation(async (page: CanvasView) => page.relativePath === pricing.relativePath ? [comment] : []),
      add: vi.fn().mockResolvedValue(comment), resolve: vi.fn().mockResolvedValue({ ...comment, resolved: true }) };
    const currentHost = { ...host, comments: store };
    await render(entry, currentHost);
    const frame = container.querySelector("iframe")!;
    const location = { source: "meowbert-canvas", type: "location", href: "https://example.test/pages/pricing%20plan.html?plan=pro#details" };
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: window, data: location })));
    expect(store.list).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: location })));
    expect(container.querySelector("iframe")).toBe(frame);
    expect(store.list).toHaveBeenLastCalledWith(pricing);
    await click("Comments");
    expect(container.textContent).toContain(comment.body);
    await click("Ask Meowbert");
    expect(sendPrompt.mock.calls[0][0]).toContain(pricing.relativePath);
    await click("Add comment");
    await pick();
    await draft(comment.body);
    await click("Save comment");
    expect(store.add).toHaveBeenCalledWith(pricing, element, comment.body);
    await click("Resolve comment");
    expect(store.resolve).toHaveBeenCalledWith(pricing, comment.id, true);
    await click("Select an element");
    await pick();
    await draft("Update pricing");
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(sendPrompt.mock.calls[1][0]).toContain(pricing.relativePath);
    await render(pricing, currentHost);
    expect(container.textContent).toContain(comment.body);
    expect(store.list).toHaveBeenLastCalledWith(pricing);
  });

  it("preserves a completed save and existing comments when an older reload read finishes", async () => {
    const existing = { id: "existing", relativePath: view.relativePath, element, body: "Existing feedback",
      resolved: false, createdAt: "2026-10-26T00:00:00Z" };
    const saved = { ...existing, id: "saved", body: "New feedback", createdAt: "2026-10-27T00:00:00Z" };
    const save = deferred<CanvasComment>();
    const reload = deferred<CanvasComment[]>();
    const store = { list: vi.fn().mockResolvedValueOnce([existing]).mockReturnValueOnce(reload.promise),
      add: vi.fn().mockReturnValue(save.promise), resolve: vi.fn() };
    await render(view, { ...host, comments: store });
    await click("Comments");
    await click("Add comment");
    await pick();
    await draft(saved.body);
    await click("Save comment");
    await click("Reload");
    await act(async () => save.resolve(saved));
    expect(container.textContent).toContain(saved.body);
    await act(async () => reload.resolve([existing]));
    expect(container.textContent).toContain(saved.body);
    expect(container.textContent).toContain(existing.body);
  });

  it("keeps a comment resolved when a reload returns the pre-mutation snapshot", async () => {
    const comment = { id: "existing", relativePath: view.relativePath, element, body: "Feedback",
      resolved: false, createdAt: "2026-10-27T00:00:00Z" };
    const resolve = deferred<CanvasComment>();
    const reload = deferred<CanvasComment[]>();
    const store = { list: vi.fn().mockResolvedValueOnce([comment]).mockReturnValueOnce(reload.promise), add: vi.fn(),
      resolve: vi.fn().mockReturnValue(resolve.promise) };
    await render(view, { ...host, comments: store });
    await click("Comments");
    await click("Resolve comment");
    await click("Reload");
    await act(async () => resolve.resolve({ ...comment, resolved: true }));
    await act(async () => reload.resolve([comment]));
    expect(container.querySelector('[aria-label="Reopen comment"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Resolve comment"]')).toBeNull();
  });
});
