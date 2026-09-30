/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { highlightConversationSearchMatch } from "./ConversationSearchMatchMarker";

function appendMessageContent(container: HTMLElement, messageId: string, content: HTMLElement): void {
  const message = document.createElement("div");
  message.dataset.messageId = messageId;
  content.classList.add("conversation-message-content");
  message.appendChild(content);
  container.appendChild(message);
}

describe("highlightConversationSearchMatch", () => {
  it("marks the selected occurrence across repeated message segments", () => {
    const container = document.createElement("div");
    const firstContent = document.createElement("div");
    firstContent.textContent = "First needle.";
    appendMessageContent(container, "message-1", firstContent);

    const secondContent = document.createElement("div");
    secondContent.textContent = "Second NEEDLE.";
    appendMessageContent(container, "message-1", secondContent);

    const cleanup = highlightConversationSearchMatch(container, {
      messageId: "message-1",
      matchIndex: 1,
      matchText: "needle"
    });

    const marks = container.querySelectorAll<HTMLElement>("[data-conversation-search-match]");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("NEEDLE");
    expect(firstContent.querySelector("mark")).toBeNull();
    expect(secondContent.querySelector("mark")).toBe(marks[0]);

    cleanup();

    expect(container.querySelector("mark")).toBeNull();
    expect(secondContent.textContent).toBe("Second NEEDLE.");
  });

  it("marks every rendered fragment when a match spans text nodes", () => {
    const container = document.createElement("div");
    const content = document.createElement("div");
    content.append("cross ");
    const emphasis = document.createElement("strong");
    emphasis.textContent = "boundary";
    content.appendChild(emphasis);
    appendMessageContent(container, "message-1", content);

    const cleanup = highlightConversationSearchMatch(container, {
      messageId: "message-1",
      matchIndex: 0,
      matchText: "cross boundary"
    });

    const marks = container.querySelectorAll<HTMLElement>("[data-conversation-search-match]");
    expect(marks).toHaveLength(2);
    expect(Array.from(marks).map((mark) => mark.textContent).join("")).toBe("cross boundary");

    cleanup();
    expect(content.textContent).toBe("cross boundary");
  });
});
