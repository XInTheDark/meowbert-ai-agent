const AT_BOTTOM_TOLERANCE_PX = 4;

export interface ConversationFeedAnchor {
  anchorMessageId: string | null;
  anchorOffsetTop: number;
}

export function findFirstVisibleMessageAnchor(
  feed: HTMLElement,
  fallbackMessageId: string | null
): ConversationFeedAnchor {
  const feedRect = feed.getBoundingClientRect();
  const messageElements = feed.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const el of messageElements) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > feedRect.top + 10) {
      return {
        anchorMessageId: el.dataset.messageId ?? fallbackMessageId,
        anchorOffsetTop: rect.top - feedRect.top
      };
    }
  }
  return {
    anchorMessageId: fallbackMessageId,
    anchorOffsetTop: 0
  };
}

function findAnchorElement(feed: HTMLElement, messageId: string): HTMLElement | null {
  for (const el of feed.querySelectorAll<HTMLElement>("[data-message-id]")) {
    if (el.dataset.messageId === messageId) {
      return el;
    }
  }
  return null;
}

const READING_BLOCK_SELECTOR = "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, tr, img, hr";

interface ReadingAnchor {
  element: HTMLElement;
  messageId: string | null;
  offsetTop: number;
}

/**
 * The block the reader is looking at: the first paragraph, list item or similar starting at or below
 * the top of the feed. Anchoring on a whole message instead pins its top, which for a long message is
 * far above the screen, so the text being read slides away when the message reflows taller.
 */
function findReadingAnchor(feed: HTMLElement): ReadingAnchor | null {
  const feedTop = feed.getBoundingClientRect().top;
  const { anchorMessageId } = findFirstVisibleMessageAnchor(feed, null);
  const messageEl = anchorMessageId ? findAnchorElement(feed, anchorMessageId) : null;
  if (!messageEl) {
    return null;
  }
  let element: HTMLElement = messageEl;
  for (const block of messageEl.querySelectorAll<HTMLElement>(READING_BLOCK_SELECTOR)) {
    const rect = block.getBoundingClientRect();
    if (rect.height > 0 && rect.top >= feedTop) {
      element = block;
      break;
    }
  }
  return { element, messageId: anchorMessageId, offsetTop: element.getBoundingClientRect().top - feedTop };
}

/**
 * Keeps what the reader is looking at in place while the feed or its content
 * changes size, e.g. when a side panel opens and the feed reflows narrower.
 * A feed that should follow the bottom stays pinned there instead.
 */
export function watchConversationFeedLayout(input: {
  feed: HTMLElement;
  shouldStickToBottom: (state: { wasAtBottom: boolean; feedResized: boolean }) => boolean;
  isScrollPending?: () => boolean;
}): () => void {
  const { feed } = input;
  if (typeof ResizeObserver !== "function") {
    return () => undefined;
  }

  let anchor: ReadingAnchor | null = null;
  let wasAtBottom = false;
  let captureFrameId: number | null = null;

  function capture(): void {
    anchor = findReadingAnchor(feed);
    wasAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= AT_BOTTOM_TOLERANCE_PX;
  }

  function scheduleCapture(): void {
    if (captureFrameId !== null) {
      return;
    }
    captureFrameId = window.requestAnimationFrame(() => {
      captureFrameId = null;
      capture();
    });
  }

  function restore(entries: ResizeObserverEntry[]): void {
    if (input.isScrollPending?.()) {
      capture();
      return;
    }
    const feedResized = entries.some((entry) => entry.target === feed);
    if (input.shouldStickToBottom({ wasAtBottom, feedResized })) {
      feed.scrollTop = feed.scrollHeight;
      capture();
      return;
    }
    const anchorEl = anchor?.element.isConnected
      ? anchor.element
      : anchor?.messageId ? findAnchorElement(feed, anchor.messageId) : null;
    if (anchor && anchorEl) {
      const delta = anchorEl.getBoundingClientRect().top - feed.getBoundingClientRect().top - anchor.offsetTop;
      if (Math.abs(delta) > 0.5) {
        feed.scrollTop = Math.max(0, feed.scrollTop + delta);
      }
    }
    capture();
  }

  const resizeObserver = new ResizeObserver(restore);
  const observeChildren = (): void => {
    for (const child of feed.children) {
      resizeObserver.observe(child);
    }
  };
  resizeObserver.observe(feed);
  observeChildren();
  const mutationObserver = typeof MutationObserver === "function"
    ? new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof Element) resizeObserver.unobserve(node);
        }
      }
      observeChildren();
    })
    : null;
  mutationObserver?.observe(feed, { childList: true });

  feed.addEventListener("scroll", scheduleCapture, { passive: true });
  capture();

  return () => {
    feed.removeEventListener("scroll", scheduleCapture);
    resizeObserver.disconnect();
    mutationObserver?.disconnect();
    if (captureFrameId !== null) {
      window.cancelAnimationFrame(captureFrameId);
    }
  };
}
