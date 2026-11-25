import { findMessageElement, type ConversationTextAnchor } from "./taskDetailConversationScroll";

/** How close to the bottom the reader must be for new content to keep the feed pinned there. */
const FOLLOW_THRESHOLD_PX = 24;
/** Gap left above a message the feed jumps to. */
const JUMP_TOP_GAP_PX = 24;
/** A jump whose message never renders is dropped after this long. */
const JUMP_TIMEOUT_MS = 3000;
const READING_BLOCK_SELECTOR = "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, tr, img, hr";
const MAX_FALLBACK_ANCHORS = 5;

interface FallbackAnchor {
  element: HTMLElement;
  messageIds: string[];
  offsetTop: number;
}

interface ReadingAnchor {
  element: HTMLElement;
  offsetTop: number;
  messageElement: HTMLElement;
  messageOffsetTop: number;
  messageIds: string[];
  fallbacks: FallbackAnchor[];
  scrollHeight: number;
  scrollTop: number;
}

interface PendingJump {
  messageId: string;
  textAnchor: ConversationTextAnchor | null;
  timeoutId: number;
}

/**
 * Owns the scroll position of one conversation feed. The feed is in one of three modes:
 * - following: pinned to the bottom, so new steps and streamed output stay in view;
 * - jumping: waiting for a requested message to render, then scrolling to it once;
 * - reading: anything else, where the block the reader is looking at stays put while content
 *   above or around it changes size (older pages prepended, panels opening, messages reflowing).
 * Only the reader's own scrolling switches between following and reading.
 */
export interface ConversationScrollController {
  /** Ref for the feed element; attaching and detaching the observers follows React's ref updates. */
  feedRef: { current: HTMLDivElement | null };
  followBottom: () => void;
  /** Switches out of bottom-follow and ensures a reading anchor is captured before content prepends. */
  holdPosition: () => void;
  jumpTo: (messageId: string, textAnchor?: ConversationTextAnchor | null) => void;
  isJumpPending: () => boolean;
  /** Whether the feed's latest scroll event came from the controller rather than the reader. */
  isProgrammaticScroll: () => boolean;
}

function distanceFromBottom(feed: HTMLElement): number {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight;
}

function readElementMessageIds(element: HTMLElement): string[] {
  const ids: string[] = [];
  if (element.dataset.messageId) {
    ids.push(element.dataset.messageId);
  }
  if (element.dataset.messageIds) {
    for (const id of element.dataset.messageIds.split(/\s+/)) {
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function findMessageByAnyId(feed: HTMLElement, messageIds: string[]): HTMLElement | null {
  if (messageIds.length === 0) return null;
  const targets = new Set(messageIds);
  for (const element of feed.querySelectorAll<HTMLElement>("[data-message-id], [data-message-ids]")) {
    if (element.dataset.messageId && targets.has(element.dataset.messageId)) {
      return element;
    }
    const grouped = element.dataset.messageIds;
    if (grouped && grouped.split(/\s+/).some((id) => targets.has(id))) {
      return element;
    }
  }
  return null;
}

/**
 * The block the reader is looking at: the first paragraph, list item or similar starting at or below
 * the top of the feed. Anchoring on a whole message instead pins its top, which for a long message is
 * far above the screen, so the text being read slides away when the message reflows taller.
 */
function findReadingAnchor(feed: HTMLElement): ReadingAnchor | null {
  const feedTop = feed.getBoundingClientRect().top;
  const messages = feed.querySelectorAll<HTMLElement>("[data-message-id]");
  let primary: Omit<ReadingAnchor, "fallbacks" | "scrollHeight" | "scrollTop"> | null = null;
  const fallbacks: FallbackAnchor[] = [];

  for (const message of messages) {
    const messageRect = message.getBoundingClientRect();
    if (messageRect.bottom <= feedTop + 10) {
      continue;
    }
    if (!primary) {
      let element = message;
      for (const block of message.querySelectorAll<HTMLElement>(READING_BLOCK_SELECTOR)) {
        const rect = block.getBoundingClientRect();
        if (rect.height > 0 && rect.top >= feedTop) {
          element = block;
          break;
        }
      }
      primary = {
        element,
        offsetTop: element.getBoundingClientRect().top - feedTop,
        messageElement: message,
        messageOffsetTop: messageRect.top - feedTop,
        messageIds: readElementMessageIds(message)
      };
      continue;
    }
    fallbacks.push({
      element: message,
      messageIds: readElementMessageIds(message),
      offsetTop: messageRect.top - feedTop
    });
    if (fallbacks.length >= MAX_FALLBACK_ANCHORS) {
      break;
    }
  }

  return primary ? { ...primary, fallbacks, scrollHeight: feed.scrollHeight, scrollTop: feed.scrollTop } : null;
}

function resolveAnchorTarget(feed: HTMLElement, anchor: ReadingAnchor): { element: HTMLElement; offsetTop: number } | null {
  if (anchor.element.isConnected) {
    return { element: anchor.element, offsetTop: anchor.offsetTop };
  }
  if (anchor.messageElement.isConnected) {
    return { element: anchor.messageElement, offsetTop: anchor.messageOffsetTop };
  }
  for (const fallback of anchor.fallbacks) {
    if (fallback.element.isConnected) {
      return { element: fallback.element, offsetTop: fallback.offsetTop };
    }
  }
  const byPrimaryId = findMessageByAnyId(feed, anchor.messageIds);
  if (byPrimaryId) {
    return { element: byPrimaryId, offsetTop: anchor.messageOffsetTop };
  }
  for (const fallback of anchor.fallbacks) {
    const byFallbackId = findMessageByAnyId(feed, fallback.messageIds);
    if (byFallbackId) {
      return { element: byFallbackId, offsetTop: fallback.offsetTop };
    }
  }
  return null;
}

export function createConversationScrollController(options?: {
  /** False while the loaded window does not reach the newest message, so there is no bottom to follow. */
  canFollow?: () => boolean;
}): ConversationScrollController {
  const canFollow = options?.canFollow ?? (() => true);
  let feed: HTMLDivElement | null = null;
  let detach: (() => void) | null = null;
  let following = true;
  let pendingJump: PendingJump | null = null;
  let anchor: ReadingAnchor | null = null;
  let programmaticScrollTop: number | null = null;

  function capture(): void {
    if (feed) {
      anchor = findReadingAnchor(feed);
    }
  }

  function setScrollTop(value: number): void {
    if (!feed) return;
    const before = feed.scrollTop;
    feed.scrollTop = Math.max(0, value);
    if (feed.scrollTop !== before) {
      programmaticScrollTop = feed.scrollTop;
    }
    capture();
  }

  function clearPendingJump(): void {
    if (pendingJump) {
      window.clearTimeout(pendingJump.timeoutId);
      pendingJump = null;
    }
  }

  function resolvePendingJump(jump: PendingJump): void {
    if (!feed) return;
    const target = findMessageElement(feed, jump.messageId, jump.textAnchor);
    if (!target) return;
    clearPendingJump();
    const offset = target.getBoundingClientRect().top - feed.getBoundingClientRect().top;
    setScrollTop(feed.scrollTop + offset - JUMP_TOP_GAP_PX);
    following = canFollow() && distanceFromBottom(feed) <= FOLLOW_THRESHOLD_PX;
  }

  function restoreReadingAnchor(): void {
    if (!feed || !anchor) return;
    const target = resolveAnchorTarget(feed, anchor);
    if (!target) {
      const heightDelta = feed.scrollHeight - anchor.scrollHeight;
      if (heightDelta > 0.5) {
        setScrollTop(anchor.scrollTop + heightDelta);
      } else {
        capture();
      }
      return;
    }
    const delta = target.element.getBoundingClientRect().top - feed.getBoundingClientRect().top - target.offsetTop;
    if (Math.abs(delta) > 0.5) {
      setScrollTop(feed.scrollTop + delta);
    } else {
      capture();
    }
  }

  /** Applies the current mode after the feed or its content changed. */
  function sync(): void {
    if (!feed) return;
    if (pendingJump) {
      resolvePendingJump(pendingJump);
      return;
    }
    if (following && canFollow()) {
      setScrollTop(feed.scrollHeight);
      return;
    }
    restoreReadingAnchor();
  }

  function handleScroll(): void {
    if (!feed) return;
    if (isProgrammaticScroll()) return;
    programmaticScrollTop = null;
    following = canFollow() && distanceFromBottom(feed) <= FOLLOW_THRESHOLD_PX;
    capture();
  }

  // Compared against the live position, so it answers correctly whichever scroll listener runs first.
  function isProgrammaticScroll(): boolean {
    return feed !== null && programmaticScrollTop !== null && Math.abs(feed.scrollTop - programmaticScrollTop) <= 0.5;
  }

  function handleWheel(event: WheelEvent): void {
    clearPendingJump();
    if (event.deltaY < 0) {
      const wasFollowing = following;
      following = false;
      if (wasFollowing || !anchor) {
        capture();
      }
    }
  }

  function attach(element: HTMLDivElement): () => void {
    element.style.overflowAnchor = "none";
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    const observeChildren = (): void => {
      for (const child of element.children) {
        resizeObserver?.observe(child);
      }
    };
    resizeObserver?.observe(element);
    observeChildren();
    const mutationObserver = typeof MutationObserver === "function"
      ? new MutationObserver(() => {
        observeChildren();
        sync();
      })
      : null;
    mutationObserver?.observe(element, { childList: true });

    element.addEventListener("scroll", handleScroll, { passive: true });
    element.addEventListener("wheel", handleWheel, { passive: true });
    element.addEventListener("touchstart", clearPendingJump, { passive: true });
    element.addEventListener("pointerdown", clearPendingJump, { passive: true });
    element.addEventListener("keydown", clearPendingJump, { passive: true });
    sync();

    return () => {
      element.removeEventListener("scroll", handleScroll);
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("touchstart", clearPendingJump);
      element.removeEventListener("pointerdown", clearPendingJump);
      element.removeEventListener("keydown", clearPendingJump);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }

  const feedRef = {
    get current(): HTMLDivElement | null {
      return feed;
    },
    set current(element: HTMLDivElement | null) {
      if (element === feed) return;
      detach?.();
      detach = null;
      feed = element;
      anchor = null;
      programmaticScrollTop = null;
      if (element) {
        detach = attach(element);
      }
    }
  };

  return {
    feedRef,
    followBottom: () => {
      clearPendingJump();
      following = true;
      sync();
    },
    holdPosition: () => {
      clearPendingJump();
      following = false;
      capture();
    },
    jumpTo: (messageId, textAnchor) => {
      clearPendingJump();
      following = false;
      const timeoutId = window.setTimeout(clearPendingJump, JUMP_TIMEOUT_MS);
      pendingJump = { messageId, textAnchor: textAnchor ?? null, timeoutId };
      sync();
    },
    isJumpPending: () => pendingJump !== null,
    isProgrammaticScroll
  };
}
