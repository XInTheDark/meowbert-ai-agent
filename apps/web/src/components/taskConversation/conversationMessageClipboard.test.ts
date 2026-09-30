// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildConversationSelectionClipboardPayload } from "./conversationMessageClipboard";

describe("buildConversationSelectionClipboardPayload", () => {
  it("preserves semantic markup while stripping chat styling attributes", () => {
    document.body.innerHTML = `
      <div id="root">
        <p class="message-paragraph" style="background: rgb(1, 2, 3);" data-message-id="msg_1">
          Hello <code class="inline-code" style="background: rgb(4, 5, 6);">world</code>
          <a href="https://example.com" class="message-link" style="color: red;" target="_blank">link</a>
        </p>
      </div>
    `;

    const root = document.getElementById("root");
    const paragraph = root?.querySelector("p");
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNode(paragraph as Node);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const payload = buildConversationSelectionClipboardPayload(root as HTMLElement, selection);

    expect(payload?.text).toContain("Hello world");
    expect(payload?.html).toContain("<p>");
    expect(payload?.html).toContain("<code>world</code>");
    expect(payload?.html).toContain('<a href="https://example.com">link</a>');
    expect(payload?.html).not.toContain("class=");
    expect(payload?.html).not.toContain("style=");
    expect(payload?.html).not.toContain("data-message-id");
    expect(payload?.html).not.toContain("target=");
  });

  it("ignores selections that extend outside the copied message root", () => {
    document.body.innerHTML = `
      <div id="root"><p>Inside</p></div>
      <p id="outside">Outside</p>
    `;

    const root = document.getElementById("root");
    const insideText = root?.querySelector("p")?.firstChild;
    const outsideText = document.getElementById("outside")?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();

    range.setStart(insideText as Node, 0);
    range.setEnd(outsideText as Node, "Outside".length);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(buildConversationSelectionClipboardPayload(root as HTMLElement, selection)).toBeNull();
  });
});
