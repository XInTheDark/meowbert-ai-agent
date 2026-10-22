/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { watchConversationFeedLayout } from "./conversationFeedLayout";

function defineMutableNumberProperty(target: object, key: string, initialValue: number): void {
  let value = initialValue;
  Object.defineProperty(target, key, {
    configurable: true,
    get: () => value,
    set: (nextValue: number) => {
      value = nextValue;
    }
  });
}

function defineDynamicRect(target: Element, getTop: () => number, height = 48): void {
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const top = getTop();
      return { x: 0, y: top, top, bottom: top + height, left: 0, right: 400, width: 400, height, toJSON: () => undefined };
    }
  });
}

let resizeCallback: ((entries: Array<{ target: Element }>) => void) | null = null;

function installResizeObserver(): void {
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: (entries: Array<{ target: Element }>) => void) {
      resizeCallback = callback;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
}

type MutableFeed = HTMLDivElement & { scrollHeight: number };

function buildFeed(): { feed: MutableFeed; message: HTMLDivElement; setContentShift: (shift: number) => void } {
  const feed = document.createElement("div") as MutableFeed;
  const message = document.createElement("div");
  message.dataset.messageId = "m-2";
  feed.appendChild(message);
  document.body.appendChild(feed);
  defineMutableNumberProperty(feed, "scrollTop", 500);
  defineMutableNumberProperty(feed, "scrollHeight", 2000);
  defineMutableNumberProperty(feed, "clientHeight", 400);
  defineDynamicRect(feed, () => 0, 400);
  let contentShift = 0;
  // Message sits 1000px into the content; its viewport offset follows scrollTop and any reflow above it.
  defineDynamicRect(message, () => 1000 + contentShift - feed.scrollTop);
  return { feed, message, setContentShift: (shift) => { contentShift = shift; } };
}

describe("watchConversationFeedLayout", () => {
  afterEach(() => {
    resizeCallback = null;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps the visible message in place when the feed reflows narrower", () => {
    installResizeObserver();
    const { feed, setContentShift } = buildFeed();
    const stop = watchConversationFeedLayout({ feed, shouldStickToBottom: () => false });

    setContentShift(240);
    feed.scrollHeight = 2600;
    resizeCallback?.([{ target: feed }]);

    expect(feed.scrollTop).toBe(740);
    stop();
  });

  it("pins a feed that follows the bottom as its content grows", () => {
    installResizeObserver();
    const { feed, message } = buildFeed();
    const stop = watchConversationFeedLayout({ feed, shouldStickToBottom: () => true });

    feed.scrollHeight = 3200;
    resizeCallback?.([{ target: message }]);

    expect(feed.scrollTop).toBe(3200);
    stop();
  });

  it("leaves an in-flight jump alone", () => {
    installResizeObserver();
    const { feed, setContentShift } = buildFeed();
    const stop = watchConversationFeedLayout({
      feed,
      shouldStickToBottom: () => false,
      isScrollPending: () => true
    });

    setContentShift(240);
    resizeCallback?.([{ target: feed }]);

    expect(feed.scrollTop).toBe(500);
    stop();
  });
});
