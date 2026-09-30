import type { TaskDetailTab } from "./taskDetailConstants";
import { distanceFromBottom } from "./taskDetailUtils";

const SCROLL_STABILIZATION_FRAME_LIMIT = 8;
const SCROLL_STABILIZATION_CLEAR_DELAY_MS = 650;

export interface ConversationTextAnchor {
  text: string;
  location: string | null;
}

function findThreadAnchor(
  renderedMessage: HTMLElement,
  targetTextAnchor: ConversationTextAnchor
): HTMLElement | null {
  const targetText = targetTextAnchor.text.trim();
  const anchors = renderedMessage.querySelectorAll<HTMLElement>("[data-thread-anchor-text]");
  for (const anchor of anchors) {
    if (anchor.dataset.threadAnchorText !== targetText) {
      continue;
    }
    if (
      targetTextAnchor.location
      && anchor.dataset.threadAnchorLocation !== targetTextAnchor.location
    ) {
      continue;
    }
    return anchor;
  }

  return null;
}

export function findMessageElement(
  feed: HTMLDivElement,
  targetMessageId: string,
  targetTextAnchor?: ConversationTextAnchor | null
): HTMLElement | null {
  const renderedMessages = feed.querySelectorAll<HTMLElement>("[data-message-id], [data-message-ids]");
  let firstMatch: HTMLElement | null = null;
  for (const renderedMessage of renderedMessages) {
    const isDirectMatch =
      renderedMessage.dataset.messageId === targetMessageId
      || renderedMessage.dataset.lastMessageId === targetMessageId;
    const isGroupMatch = !isDirectMatch && Boolean(renderedMessage.dataset.messageIds?.includes(targetMessageId));

    if (isDirectMatch || isGroupMatch) {
      firstMatch ??= renderedMessage;
      if (targetTextAnchor) {
        const threadAnchor = findThreadAnchor(renderedMessage, targetTextAnchor);
        if (threadAnchor) {
          return threadAnchor;
        }
      }
      const searchMatch = renderedMessage.querySelector<HTMLElement>(
        '[data-conversation-search-match="current"]'
      );
      if (searchMatch) {
        return searchMatch;
      }
    }
  }

  return firstMatch;
}

function requestScrollFrame(callback: () => void): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }

  return window.setTimeout(callback, 16);
}

function cancelScrollFrame(frameId: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frameId);
    return;
  }

  window.clearTimeout(frameId);
}

export function scrollConversationMessageIntoView(input: {
  feed: HTMLDivElement;
  targetMessageId: string;
  targetTextAnchor?: ConversationTextAnchor | null;
  behavior: ScrollBehavior;
}): boolean {
  const targetMessage = findMessageElement(
    input.feed,
    input.targetMessageId,
    input.targetTextAnchor
  );
  if (!targetMessage) {
    return false;
  }

  const feedRect = input.feed.getBoundingClientRect();
  const targetRect = targetMessage.getBoundingClientRect();
  const nextScrollTop = Math.max(
    0,
    input.feed.scrollTop + targetRect.top - feedRect.top - 24
  );

  if (typeof input.feed.scrollTo === "function") {
    input.feed.scrollTo({
      top: nextScrollTop,
      behavior: input.behavior
    });
  } else {
    input.feed.scrollTop = nextScrollTop;
  }

  return true;
}

export function watchPendingConversationScroll(input: {
  activeTab: TaskDetailTab;
  chatFeedRef: { current: HTMLDivElement | null };
  conversationNearBottomRef: { current: boolean };
  pendingConversationScrollBehaviorRef: { current: ScrollBehavior };
  pendingConversationScrollMessageIdRef: { current: string | null };
  pendingConversationScrollTextAnchorRef?: { current: ConversationTextAnchor | null };
}): () => void {
  if (input.activeTab !== "conversation") {
    return () => undefined;
  }

  const pendingTargetMessageId = input.pendingConversationScrollMessageIdRef.current;
  if (!pendingTargetMessageId) {
    return () => undefined;
  }
  const targetMessageId: string = pendingTargetMessageId;
  const targetTextAnchor = input.pendingConversationScrollTextAnchorRef?.current ?? null;

  const currentFeed = input.chatFeedRef.current;
  if (!currentFeed) {
    return () => undefined;
  }
  const feed: HTMLDivElement = currentFeed;

  let observer: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let observedTarget: HTMLElement | null = null;
  let frameId: number | null = null;
  let clearTimeoutId: number | null = null;
  let scrollAttempts = 0;
  let stopped = false;

  function cleanup(): void {
    feed.removeEventListener("wheel", finishScroll);
    feed.removeEventListener("touchstart", finishScroll);
    feed.removeEventListener("pointerdown", finishScroll);
    feed.removeEventListener("keydown", finishScroll);
    observer?.disconnect();
    observer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedTarget = null;
    if (frameId !== null) {
      cancelScrollFrame(frameId);
      frameId = null;
    }
    if (clearTimeoutId !== null) {
      window.clearTimeout(clearTimeoutId);
      clearTimeoutId = null;
    }
  }

  function finishScroll(): void {
    if (stopped) {
      return;
    }

    stopped = true;
    input.pendingConversationScrollMessageIdRef.current = null;
    if (input.pendingConversationScrollTextAnchorRef) {
      input.pendingConversationScrollTextAnchorRef.current = null;
    }
    input.pendingConversationScrollBehaviorRef.current = "auto";
    input.conversationNearBottomRef.current = distanceFromBottom(feed) <= 180;
    cleanup();
  }

  const scheduleFinish = (): void => {
    if (clearTimeoutId !== null) {
      window.clearTimeout(clearTimeoutId);
    }
    clearTimeoutId = window.setTimeout(finishScroll, SCROLL_STABILIZATION_CLEAR_DELAY_MS);
  };

  const scheduleFrameAttempt = (): void => {
    if (stopped || frameId !== null || scrollAttempts >= SCROLL_STABILIZATION_FRAME_LIMIT) {
      return;
    }

    frameId = requestScrollFrame(() => {
      frameId = null;
      attemptScroll();
    });
  };

  const observeTarget = (targetMessage: HTMLElement | null): void => {
    if (!resizeObserver || !targetMessage || observedTarget === targetMessage) {
      return;
    }

    if (observedTarget) {
      resizeObserver.unobserve(observedTarget);
    }
    observedTarget = targetMessage;
    resizeObserver.observe(targetMessage);
  };

  function attemptScroll(): boolean {
    if (input.pendingConversationScrollMessageIdRef.current !== targetMessageId) {
      stopped = true;
      cleanup();
      return true;
    }

    const targetMessage = findMessageElement(feed, targetMessageId);
    observeTarget(targetMessage);

    const didScroll = scrollConversationMessageIntoView({
      feed,
      targetMessageId,
      targetTextAnchor,
      behavior: input.pendingConversationScrollBehaviorRef.current
    });
    if (!didScroll) {
      scrollAttempts += 1;
      scheduleFinish();
      scheduleFrameAttempt();
      return false;
    }

    scrollAttempts += 1;
    scheduleFinish();
    scheduleFrameAttempt();
    return true;
  }

  feed.addEventListener("wheel", finishScroll, { passive: true });
  feed.addEventListener("touchstart", finishScroll, { passive: true });
  feed.addEventListener("pointerdown", finishScroll, { passive: true });
  feed.addEventListener("keydown", finishScroll, { passive: true });

  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      scrollAttempts = 0;
      attemptScroll();
    });
    resizeObserver.observe(feed);
  }

  if (attemptScroll() && stopped) {
    return () => undefined;
  }

  if (typeof MutationObserver === "function") {
    observer = new MutationObserver(() => {
      if (observedTarget) {
        return;
      }
      scrollAttempts = 0;
      attemptScroll();
    });
    observer.observe(feed, { childList: true, subtree: true });
  }

  return () => {
    stopped = true;
    cleanup();
  };
}
