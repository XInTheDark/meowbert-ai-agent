import { useLayoutEffect, type RefObject } from "react";
import type { TaskConversationSearchMatch, TaskMessage } from "../../lib/types";

interface SearchableTextNode {
  node: Text;
  start: number;
  end: number;
}

function getMessageElements(container: HTMLElement, messageId: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-message-id], [data-message-ids]"))
    .filter((element) => {
      if (element.dataset.messageId === messageId || element.dataset.lastMessageId === messageId) {
        return true;
      }
      return Boolean(element.dataset.messageIds?.includes(messageId));
    });
}

function collectSearchableTextNodes(container: HTMLElement, messageId: string): {
  text: string;
  nodes: SearchableTextNode[];
} {
  const nodes: SearchableTextNode[] = [];
  let text = "";

  getMessageElements(container, messageId).forEach((messageElement, messageElementIndex) => {
    const contentElements = messageElement.querySelectorAll<HTMLElement>(".conversation-message-content");
    contentElements.forEach((contentElement, contentElementIndex) => {
      if (messageElementIndex > 0 || contentElementIndex > 0) {
        text += "\u0000";
      }

      const walker = document.createTreeWalker(contentElement, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const node = current as Text;
        const start = text.length;
        text += node.data;
        nodes.push({ node, start, end: text.length });
        current = walker.nextNode();
      }
    });
  });

  return { text, nodes };
}

function findOccurrenceStart(text: string, matchText: string, matchIndex: number): number {
  const normalizedText = text.toLowerCase();
  const normalizedMatch = matchText.toLowerCase();
  let searchFrom = 0;

  for (let currentIndex = 0; currentIndex <= matchIndex; currentIndex += 1) {
    const matchStart = normalizedText.indexOf(normalizedMatch, searchFrom);
    if (matchStart < 0) {
      return -1;
    }
    if (currentIndex === matchIndex) {
      return matchStart;
    }
    searchFrom = matchStart + 1;
  }

  return -1;
}

function markTextRange(nodes: SearchableTextNode[], start: number, end: number): HTMLElement[] {
  const marks: HTMLElement[] = [];

  [...nodes].reverse().forEach(({ node, start: nodeStart, end: nodeEnd }) => {
    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(node.data.length, end - nodeStart);
    if (localStart >= localEnd || !node.parentNode) {
      return;
    }

    let matchNode = node;
    if (localEnd < matchNode.data.length) {
      matchNode.splitText(localEnd);
    }
    if (localStart > 0) {
      matchNode = matchNode.splitText(localStart);
    }

    const mark = document.createElement("mark");
    mark.className = "conversation-search-match";
    mark.dataset.conversationSearchMatch = "current";
    matchNode.parentNode?.replaceChild(mark, matchNode);
    mark.appendChild(matchNode);
    marks.push(mark);
  });

  return marks;
}

function clearMarks(marks: HTMLElement[]): void {
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    mark.replaceWith(...Array.from(mark.childNodes));
    parent.normalize();
  });
}

export function highlightConversationSearchMatch(
  container: HTMLElement,
  match: TaskConversationSearchMatch
): () => void {
  const searchable = collectSearchableTextNodes(container, match.messageId);
  const matchStart = findOccurrenceStart(searchable.text, match.matchText, match.matchIndex);
  if (matchStart < 0) {
    return () => undefined;
  }

  const marks = markTextRange(searchable.nodes, matchStart, matchStart + match.matchText.length);
  return () => clearMarks(marks);
}

export function ConversationSearchMatchMarker(props: {
  containerRef: RefObject<HTMLElement>;
  match: TaskConversationSearchMatch | null;
  messages: TaskMessage[];
}): null {
  useLayoutEffect(() => {
    const container = props.containerRef.current;
    if (!container || !props.match) {
      return;
    }

    return highlightConversationSearchMatch(container, props.match);
  }, [props.containerRef, props.match, props.messages]);

  return null;
}
