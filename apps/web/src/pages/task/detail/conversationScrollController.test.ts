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

  it("keeps the viewport anchored on a surviving message below when the top message folds on prepend", () => {
    const feed = buildFeed(6);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;

    readerScrollsTo(feed, 0);
    // Simulate older messages prepending and folding m-0 into a grouped bubble above m-1.
    const topRow = feed.children[0]!;
    topRow.remove();
    const fold = document.createElement("div");
    fold.dataset.messageId = "older-0";
    fold.dataset.messageIds = "older-0 older-1 m-0";
    feed.prepend(fold);
    for (let index = 4; index >= 0; index -= 1) {
      const older = document.createElement("div");
      older.dataset.messageId = `older-pre-${index}`;
      feed.prepend(older);
    }
    contentChanged();

    // 5 prepended rows + fold replacing m-0 shifted m-1 down by 500px; scrollTop follows m-1 instead of staying at 0.
    expect(feed.scrollTop).toBe(500);
  });

  it("matches grouped data-message-ids when no earlier message element stays connected", () => {
    const feed = buildFeed(1);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;

    scroll.holdPosition();
    feed.innerHTML = "";
    for (let index = 0; index < 4; index += 1) {
      appendRow(feed, `older-${index}`);
    }
    const grouped = document.createElement("div");
    grouped.dataset.messageId = "older-merged";
    grouped.dataset.messageIds = "older-merged m-0";
    feed.appendChild(grouped);
    for (let index = 0; index < 4; index += 1) {
      appendRow(feed, `after-${index}`);
    }
    contentChanged();

    expect(feed.scrollTop).toBe(400);
  });

  it("falls back to scrollHeight delta when every visible row is replaced during prepend", () => {
    const feed = buildFeed(4);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;

    readerScrollsTo(feed, 50);
    feed.innerHTML = "";
    for (let index = 0; index < 9; index += 1) {
      appendRow(feed, `replaced-${index}`);
    }
    contentChanged();

    // scrollHeight grew by 500px (from 400 to 900); scrollTop shifts from 50 to 550 instead of staying near 0.
    expect(feed.scrollTop).toBe(550);
  });

  it("holds reading position instead of snapping to bottom when holdPosition is called before prepend", () => {
    const feed = buildFeed(4);
    const scroll = createConversationScrollController();
    scroll.feedRef.current = feed;
    expect(feed.scrollTop).toBe(100);

    scroll.holdPosition();
    for (let index = 3; index >= 0; index -= 1) {
      const older = document.createElement("div");
      older.dataset.messageId = `older-${index}`;
      feed.prepend(older);
    }
    contentChanged();

    expect(feed.scrollTop).toBe(500);
  });
});
