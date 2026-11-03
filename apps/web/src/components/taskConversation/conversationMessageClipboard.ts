import { buildCitationToken } from "./composer/citationToken";

// Pills copy as their citation token, so pasting into the composer gives the pill back. The rendered
// href holds a short-lived file ticket, which must not reach the clipboard.
function restoreCopiedCitations(container: HTMLElement, selectedText: string): string {
  let text = selectedText;
  let cursor = 0;
  container.querySelectorAll<HTMLElement>("[data-citation-path]").forEach((pill) => {
    const path = pill.dataset.citationPath ?? "";
    const label = pill.textContent ?? "";
    pill.setAttribute("href", path);
    const index = text.indexOf(label, cursor);
    if (index < 0) return;
    const token = buildCitationToken({ label, path });
    text = `${text.slice(0, index)}${token}${text.slice(index + label.length)}`;
    cursor = index + token.length;
  });
  return text;
}

function isNodeInsideRoot(root: HTMLElement, node: Node | null): boolean {
  if (!node) {
    return false;
  }

  return root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
}

function sanitizeClipboardElement(element: Element): void {
  const attributes = [...element.attributes];

  for (const attribute of attributes) {
    const name = attribute.name.toLowerCase();
    const shouldPreserve =
      (element.tagName === "A" && name === "href")
      || (element.tagName === "IMG" && (name === "src" || name === "alt"));

    if (!shouldPreserve) {
      element.removeAttribute(attribute.name);
    }
  }
}

function sanitizeClipboardContainer(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];

  while (walker.nextNode()) {
    elements.push(walker.currentNode as Element);
  }

  for (const element of elements) {
    sanitizeClipboardElement(element);
  }
}

export function buildConversationSelectionClipboardPayload(
  root: HTMLElement | null,
  selection: Selection | null
): { html: string; text: string } | null {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const selectedText = selection.toString();
  if (selectedText.trim().length === 0) {
    return null;
  }

  const container = document.createElement("div");

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!isNodeInsideRoot(root, range.startContainer) || !isNodeInsideRoot(root, range.endContainer)) {
      return null;
    }

    container.append(range.cloneContents());
  }

  const text = restoreCopiedCitations(container, selectedText);
  sanitizeClipboardContainer(container);

  return {
    html: container.innerHTML,
    text
  };
}
