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

export function isConversationMessageInView(
  feed: HTMLDivElement,
  targetMessageId: string,
  targetTextAnchor?: ConversationTextAnchor | null
): boolean {
  const targetMessage = findMessageElement(feed, targetMessageId, targetTextAnchor);
  if (!targetMessage) {
    return false;
  }

  const feedRect = feed.getBoundingClientRect();
  const targetRect = targetMessage.getBoundingClientRect();
  return targetRect.bottom > feedRect.top && targetRect.top < feedRect.bottom;
}
