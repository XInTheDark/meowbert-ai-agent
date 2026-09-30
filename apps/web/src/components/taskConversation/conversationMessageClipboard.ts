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

  sanitizeClipboardContainer(container);

  return {
    html: container.innerHTML,
    text: selectedText
  };
}
