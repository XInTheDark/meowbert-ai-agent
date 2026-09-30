/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  scrollConversationMessageIntoView,
  watchPendingConversationScroll
} from "./taskDetailConversationScroll";

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

function defineRect(target: Element, top: number, height = 48): void {
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 400,
      width: 400,
      height,
      toJSON: () => undefined
    })
  });
}

function defineRectRelativeToFeed(feed: HTMLDivElement, target: Element, documentTop: number, height = 48): void {
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const top = documentTop - feed.scrollTop;
      return {
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 400,
        width: 400,
        height,
        toJSON: () => undefined
      };
    }
  });
}

function createFeed(): HTMLDivElement & { scrollTo: ReturnType<typeof vi.fn> } {
  const feed = document.createElement("div") as HTMLDivElement & { scrollTo: ReturnType<typeof vi.fn> };
  defineMutableNumberProperty(feed, "scrollTop", 120);
  defineMutableNumberProperty(feed, "clientHeight", 300);
  defineMutableNumberProperty(feed, "scrollHeight", 1000);
  defineRect(feed, 0, 300);

  feed.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    if (typeof top === "number") {
      feed.scrollTop = top;
    }
  });

  document.body.appendChild(feed);
  return feed;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("taskDetailConversationScroll", () => {
  it("scrolls to the target message row when it is already rendered", () => {
    const feed = createFeed();
    const target = document.createElement("div");
    target.dataset.messageId = "message-42";
    defineRect(target, 280, 56);
    feed.appendChild(target);

    const didScroll = scrollConversationMessageIntoView({
      feed,
      targetMessageId: "message-42",
      behavior: "auto"
    });

    expect(didScroll).toBe(true);
    expect(feed.scrollTo).toHaveBeenCalledWith({
      top: 376,
      behavior: "auto"
    });
  });

  it("scrolls to the selected search occurrence inside the target message", () => {
    const feed = createFeed();
    const firstSegment = document.createElement("div");
    firstSegment.dataset.messageId = "message-42";
    defineRect(firstSegment, 280, 56);
    feed.appendChild(firstSegment);

    const matchingSegment = document.createElement("div");
    matchingSegment.dataset.messageId = "message-42";
    const match = document.createElement("mark");
    match.dataset.conversationSearchMatch = "current";
    defineRect(match, 640, 20);
    matchingSegment.appendChild(match);
    feed.appendChild(matchingSegment);

    const didScroll = scrollConversationMessageIntoView({
      feed,
      targetMessageId: "message-42",
      behavior: "auto"
    });

    expect(didScroll).toBe(true);
    expect(feed.scrollTo).toHaveBeenCalledWith({
      top: 736,
      behavior: "auto"
    });
  });

  it("scrolls to the selected-text anchor that created the thread", () => {
    const feed = createFeed();
    const message = document.createElement("div");
    message.dataset.messageId = "message-42";
    defineRect(message, 280, 180);

    const staleSearchMatch = document.createElement("mark");
    staleSearchMatch.dataset.conversationSearchMatch = "current";
    defineRect(staleSearchMatch, 320, 20);
    message.appendChild(staleSearchMatch);

    const otherAnchor = document.createElement("button");
    otherAnchor.dataset.threadAnchorText = "other text";
    otherAnchor.dataset.threadAnchorLocation = "line 2:1 to line 2:11";
    defineRect(otherAnchor, 420, 20);
    message.appendChild(otherAnchor);

    const targetAnchor = document.createElement("button");
    targetAnchor.dataset.threadAnchorText = "selected text";
    targetAnchor.dataset.threadAnchorLocation = "line 8:3 to line 8:16";
    defineRect(targetAnchor, 640, 20);
    message.appendChild(targetAnchor);
    feed.appendChild(message);

    const didScroll = scrollConversationMessageIntoView({
      feed,
      targetMessageId: "message-42",
      targetTextAnchor: {
        text: "selected text",
        location: "line 8:3 to line 8:16"
      },
      behavior: "auto"
    });

    expect(didScroll).toBe(true);
    expect(feed.scrollTo).toHaveBeenCalledWith({
      top: 736,
      behavior: "auto"
    });
  });

  it("keeps watching until the pending target row mounts", async () => {
    vi.useFakeTimers();
    const feed = createFeed();
    const pendingConversationScrollMessageIdRef = { current: "message-late" as string | null };
    const pendingConversationScrollBehaviorRef = { current: "smooth" as ScrollBehavior };
    const conversationNearBottomRef = { current: true };

    const stopWatching = watchPendingConversationScroll({
      activeTab: "conversation",
      chatFeedRef: { current: feed },
      conversationNearBottomRef,
      pendingConversationScrollBehaviorRef,
      pendingConversationScrollMessageIdRef
    });

    expect(feed.scrollTo).not.toHaveBeenCalled();
    expect(pendingConversationScrollMessageIdRef.current).toBe("message-late");

    const target = document.createElement("div");
    target.dataset.messageId = "message-late";
    defineRectRelativeToFeed(feed, target, 380, 52);
    feed.appendChild(target);

    await Promise.resolve();

    expect(feed.scrollTo).toHaveBeenCalledWith({
      top: 356,
      behavior: "smooth"
    });
    expect(pendingConversationScrollMessageIdRef.current).toBe("message-late");

    await vi.runAllTimersAsync();

    expect(pendingConversationScrollMessageIdRef.current).toBeNull();
    expect(pendingConversationScrollBehaviorRef.current).toBe("auto");
    expect(conversationNearBottomRef.current).toBe(false);

    stopWatching();
  });

  it("stops retrying a pending jump when the user scrolls", async () => {
    vi.useFakeTimers();
    const feed = createFeed();
    const target = document.createElement("div");
    target.dataset.messageId = "message-42";
    defineRectRelativeToFeed(feed, target, 380, 52);
    feed.appendChild(target);
    const pendingConversationScrollMessageIdRef = { current: "message-42" as string | null };
    const pendingConversationScrollBehaviorRef = { current: "auto" as ScrollBehavior };
    const conversationNearBottomRef = { current: true };

    const stopWatching = watchPendingConversationScroll({
      activeTab: "conversation",
      chatFeedRef: { current: feed },
      conversationNearBottomRef,
      pendingConversationScrollBehaviorRef,
      pendingConversationScrollMessageIdRef
    });

    expect(feed.scrollTo).toHaveBeenCalledTimes(1);

    feed.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    await vi.runAllTimersAsync();

    expect(pendingConversationScrollMessageIdRef.current).toBeNull();
    expect(feed.scrollTo).toHaveBeenCalledTimes(1);

    stopWatching();
  });

  it("scrolls to a grouped message matched by data-last-message-id or data-message-ids", () => {
    const feed = createFeed();
    const group = document.createElement("div");
    group.dataset.messageId = "tool-1";
    group.dataset.lastMessageId = "tool-50";
    group.dataset.messageIds = "tool-1 tool-2 tool-25 tool-50";
    defineRect(group, 280, 60);
    feed.appendChild(group);

    const didScrollLast = scrollConversationMessageIntoView({
      feed,
      targetMessageId: "tool-50",
      behavior: "auto"
    });
    expect(didScrollLast).toBe(true);

    const didScrollMiddle = scrollConversationMessageIntoView({
      feed,
      targetMessageId: "tool-25",
      behavior: "auto"
    });
    expect(didScrollMiddle).toBe(true);
  });

  it("clears pending target message ref after timeout even if element never mounts", async () => {
    vi.useFakeTimers();
    const feed = createFeed();
    const pendingConversationScrollMessageIdRef = { current: "missing-message" as string | null };
    const pendingConversationScrollBehaviorRef = { current: "auto" as ScrollBehavior };
    const conversationNearBottomRef = { current: true };

    const stopWatching = watchPendingConversationScroll({
      activeTab: "conversation",
      chatFeedRef: { current: feed },
      conversationNearBottomRef,
      pendingConversationScrollBehaviorRef,
      pendingConversationScrollMessageIdRef
    });

    expect(pendingConversationScrollMessageIdRef.current).toBe("missing-message");

    await vi.runAllTimersAsync();

    expect(pendingConversationScrollMessageIdRef.current).toBeNull();
    stopWatching();
  });

  it("stops retrying a pending jump when user interacts via pointerdown or keydown", async () => {
    vi.useFakeTimers();
    const feed = createFeed();
    const target = document.createElement("div");
    target.dataset.messageId = "message-42";
    defineRectRelativeToFeed(feed, target, 380, 52);
    feed.appendChild(target);

    const pendingRef1 = { current: "message-42" as string | null };
    const stop1 = watchPendingConversationScroll({
      activeTab: "conversation",
      chatFeedRef: { current: feed },
      conversationNearBottomRef: { current: true },
      pendingConversationScrollBehaviorRef: { current: "auto" as ScrollBehavior },
      pendingConversationScrollMessageIdRef: pendingRef1
    });
    feed.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(pendingRef1.current).toBeNull();
    stop1();

    const pendingRef2 = { current: "message-42" as string | null };
    const stop2 = watchPendingConversationScroll({
      activeTab: "conversation",
      chatFeedRef: { current: feed },
      conversationNearBottomRef: { current: true },
      pendingConversationScrollBehaviorRef: { current: "auto" as ScrollBehavior },
      pendingConversationScrollMessageIdRef: pendingRef2
    });
    feed.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await vi.runAllTimersAsync();
    expect(pendingRef2.current).toBeNull();
    stop2();
  });
});
