/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConversationScrollController } from "./conversationScrollController";

const ROW_HEIGHT = 100;
let resizeCallbacks: Array<() => void> = [];

// Rows are laid out in order with a fixed height, so the feed's geometry follows its children.
function buildFeed(rowCount: number): HTMLDivElement {
  const feed = document.createElement("div");
  let scrollTop = 0;
  Object.defineProperty(feed, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(feed, "scrollHeight", { configurable: true, get: () => feed.children.length * ROW_HEIGHT });
  Object.defineProperty(feed, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.min(Math.max(0, value), Math.max(0, feed.scrollHeight - feed.clientHeight));
    }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this === feed ? 0 : Array.from(feed.children).indexOf(this) * ROW_HEIGHT - feed.scrollTop;
    return { x: 0, y: top, top, bottom: top + ROW_HEIGHT, left: 0, right: 400, width: 400, height: ROW_HEIGHT, toJSON: () => undefined };
  });
  for (let index = 0; index < rowCount; index += 1) {
    appendRow(feed, `m-${index}`);
  }
  document.body.appendChild(feed);
  return feed;
}

function appendRow(feed: HTMLElement, messageId: string): void {
  const row = document.createElement("div");
  row.dataset.messageId = messageId;
  feed.appendChild(row);
}

function readerScrollsTo(feed: HTMLElement, top: number): void {
  feed.scrollTop = top;
  feed.dispatchEvent(new Event("scroll"));
}

function contentChanged(): void {
  for (const callback of resizeCallbacks) callback();
}

describe("createConversationScrollController", () => {
  beforeEach(() => {
    resizeCallbacks = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps a feed at the bottom pinned there as new steps arrive", () => {
    const feed = buildFeed(10);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;
    expect(feed.scrollTop).toBe(700);

    appendRow(feed, "m-10");
    contentChanged();

    expect(feed.scrollTop).toBe(800);
  });

  it("leaves the reader where they are once they scroll up", () => {
    const feed = buildFeed(10);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;

    readerScrollsTo(feed, 250);
    appendRow(feed, "m-10");
    contentChanged();

    expect(feed.scrollTop).toBe(250);
  });

  it("resumes following when the reader scrolls back to the bottom", () => {
    const feed = buildFeed(10);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;

    readerScrollsTo(feed, 250);
    readerScrollsTo(feed, 700);
    appendRow(feed, "m-10");
    contentChanged();

    expect(feed.scrollTop).toBe(800);
  });

  it("jumps to a message once it renders and does not snap back to it on later updates", () => {
    const feed = buildFeed(10);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;

    scroll.jumpTo("m-10");
    expect(scroll.isJumpPending()).toBe(true);
    appendRow(feed, "m-10");
    appendRow(feed, "m-11");
    appendRow(feed, "m-12");
    contentChanged();
    expect(feed.scrollTop).toBe(976);
    expect(scroll.isJumpPending()).toBe(false);

    readerScrollsTo(feed, 500);
    appendRow(feed, "m-13");
    contentChanged();

    expect(feed.scrollTop).toBe(500);
  });

  it("tells the reader's scrolling apart from its own", () => {
    const feed = buildFeed(10);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;
    expect(scroll.isProgrammaticScroll()).toBe(true);

    readerScrollsTo(feed, 250);

    expect(scroll.isProgrammaticScroll()).toBe(false);
  });
});
