/** @vitest-environment jsdom */
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationNavigation } from "@meowbert/shared/conversation-organization";
import type { ApiClient } from "../../../../lib/api";
import { useConversationNavigation } from "./useConversationNavigation";
import { ConversationNavigationPane } from "./ConversationNavigationPane";

const id = "10000000-0000-4000-8000-000000000001";
const data: ConversationNavigation = { enabled: true, active_leaf_message_id: id, map: null,
  outline: { markdown: `## Key points\n\n[Revisit induction](#message-${id})`, message_id: id },
  turns: [{ id, message_ids: [id], user_message_id: null, summary: "Explain induction", has_summary: true, completed: true, index: 1 }], messages: [] };
let container: HTMLDivElement;
let root: Root;
const get = vi.fn(async () => data);
const api = { get } as unknown as ApiClient;
const onJump = vi.fn();
function Harness(props: { enabled: boolean; leafId?: string; overlay?: boolean }) {
  const navigation = useConversationNavigation({ api, taskId: "test", enabled: props.enabled, leafId: props.leafId ?? id, refreshKey: "1" });
  const chatFeedRef = useRef<HTMLDivElement>(null);
  return <div ref={navigation.containerRef}>
    <button onClick={() => navigation.toggle("outline")}>Outline</button>
    {navigation.enabled ? <ConversationNavigationPane controller={navigation} overlay={props.overlay ?? false} summaries chatFeedRef={chatFeedRef} onJump={onJump} /> : null}
    <main ref={chatFeedRef}><button>Send message</button></main>
  </div>;
}
async function render(props: Parameters<typeof Harness>[0]) { await act(async () => root.render(<Harness {...props} />)); }
async function fetchNavigation() { await act(async () => { await vi.advanceTimersByTimeAsync(151); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); get.mockResolvedValue(data);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), clear: () => storage.clear()
  } });
  window.localStorage.clear(); window.localStorage.setItem("conversation-navigation:test:open", "true"); window.localStorage.setItem("conversation-navigation:test:view", "outline");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe("conversation navigation", () => {
  it("gates reads and restores saved pane state when re-enabled", async () => {
    await render({ enabled: false }); await fetchNavigation();
    expect(get).not.toHaveBeenCalled(); expect(container.querySelector("aside")).toBeNull();
    await render({ enabled: true }); await fetchNavigation();
    expect(container.querySelector("aside")?.hidden).toBe(false);
    expect(container.textContent).toContain("Revisit induction");
    await render({ enabled: false });
    expect(container.querySelector("aside")).toBeNull();
    await render({ enabled: true }); await fetchNavigation();
    expect(container.textContent).toContain("Revisit induction");
  });

  it("refreshes Markdown without replacing the scroll container and routes message links", async () => {
    await render({ enabled: true }); await fetchNavigation();
    const body = container.querySelector<HTMLDivElement>(".conversation-outline-body")!;
    body.scrollTop = 125;
    get.mockResolvedValue({ ...data, outline: { markdown: `${data.outline!.markdown}\n\nNew detail`, message_id: id } });
    await render({ enabled: true, leafId: "new-leaf" });
    expect(container.querySelector(".conversation-outline-body")).toBe(body);
    await fetchNavigation();
    expect(body.scrollTop).toBe(125); expect(body.textContent).toContain("New detail");
    await act(async () => body.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onJump).toHaveBeenCalledWith(id);
  });

  it("uses roving keyboard tabs and preserves the inactive outline", async () => {
    await render({ enabled: true }); await fetchNavigation();
    const body = container.querySelector(".conversation-outline-body");
    const outline = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
    await act(async () => outline.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement?.textContent).toBe("List");
    expect(container.querySelector(".conversation-outline-body")).toBe(body);
    expect(container.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  });

  it("contains overlay focus, closes on Escape, and restores the trigger", async () => {
    window.localStorage.setItem("conversation-navigation:test:open", "false");
    await render({ enabled: true, overlay: true }); await fetchNavigation();
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    trigger.focus(); await act(async () => trigger.click());
    expect(container.querySelector("main")?.inert).toBe(true);
    expect(document.activeElement?.getAttribute("role")).toBe("tab");
    const link = container.querySelector<HTMLAnchorElement>(".conversation-outline-body a")!;
    link.focus(); await act(async () => link.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement?.getAttribute("role")).toBe("tab");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("aside")?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector("main")?.inert).not.toBe(true);
  });

  it("honors the server gate when workspace bootstrap settings are stale", async () => {
    get.mockResolvedValue({ ...data, enabled: false, outline: null, map: null, turns: [] });
    await render({ enabled: true }); await fetchNavigation();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("expands a map summary in the overlay without navigating until its jump action is used", async () => {
    window.localStorage.setItem("conversation-navigation:test:view", "map");
    const summary = "Created a conversation outline and topic map for testing long-conversation organisation.";
    get.mockResolvedValue({ ...data, turns: [{ ...data.turns[0], summary, user_message_id: "user-message" }] });
    await render({ enabled: true, overlay: true }); await fetchNavigation();
    const node = container.querySelector<HTMLButtonElement>(".conversation-map-summary")!;
    await act(async () => node.click());
    expect(node.getAttribute("aria-expanded")).toBe("true");
    expect(node.textContent).toContain(summary);
    expect(node.closest(".conversation-map-node")?.classList.contains("summary-expanded")).toBe(true);
    expect(container.querySelector("aside")?.hidden).toBe(false);
    expect(onJump).not.toHaveBeenCalled();
    const jump = container.querySelector<HTMLButtonElement>('[aria-label="Jump to turn 1"]')!;
    await act(async () => jump.click());
    expect(onJump).toHaveBeenCalledWith("user-message");
    expect(container.querySelector("aside")?.hidden).toBe(true);
  });

  it("collapses a summary on a second click or Escape without closing the pane", async () => {
    window.localStorage.setItem("conversation-navigation:test:view", "map");
    await render({ enabled: true }); await fetchNavigation();
    const node = container.querySelector<HTMLButtonElement>(".conversation-map-summary")!;
    await act(async () => node.click());
    await act(async () => node.click());
    expect(node.getAttribute("aria-expanded")).toBe("false");
    await act(async () => node.click());
    const jump = container.querySelector<HTMLButtonElement>('[aria-label="Jump to turn 1"]')!;
    jump.focus();
    await act(async () => jump.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(node.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(node);
    expect(container.querySelector("aside")?.hidden).toBe(false);
  });
});
