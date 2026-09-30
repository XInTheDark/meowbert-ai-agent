/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantSelectionContent } from "./AssistantSelectionContent";
import type { TaskAssistantMessageDisplayPreferences } from "../../lib/types";

const displayPreferences: TaskAssistantMessageDisplayPreferences = {
  collapseLongMessages: true,
  renderMarkdown: false,
  renderCommonHtml: true,
  hideCitationMarkers: true,
  renderUserMessages: false,
  renderLatex: false,
  allowSingleDollarLatex: false,
  showThoughts: true,
  showMessageSummaries: true,
  showScrollToBottomButton: true,
  showSelectionThreadActions: true,
  showSelectionThreadHighlights: true
};

function defineRect(target: Element | Range, rect: Partial<DOMRect>): void {
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: rect.x ?? 0,
      y: rect.y ?? 0,
      top: rect.top ?? 0,
      bottom: rect.bottom ?? 20,
      left: rect.left ?? 0,
      right: rect.right ?? 120,
      width: rect.width ?? 120,
      height: rect.height ?? 20,
      toJSON: () => undefined
    })
  });
}

async function selectText(container: HTMLDivElement, start: number, end: number): Promise<void> {
  const selectionContainer = container.querySelector<HTMLElement>(".assistant-selection-content");
  const textNode = container.querySelector<HTMLElement>(".bubble-plain-text")?.firstChild;
  expect(selectionContainer).toBeTruthy();
  expect(textNode).toBeTruthy();
  defineRect(selectionContainer!, { width: 300, right: 300, top: 0 });
  const range = document.createRange();
  range.setStart(textNode!, start);
  range.setEnd(textNode!, end);
  defineRect(range, { left: 10, right: 90, width: 80, top: 18, bottom: 38 });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  await act(async () => {
    selectionContainer!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

describe("AssistantSelectionContent", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    vi.restoreAllMocks();
    container?.remove();
    container = null;
    root = null;
  });

  it("does not mount more document selection listeners as assistant messages grow", async () => {
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="assistant message"
          displayPreferences={displayPreferences}
          enabled
        />
      );
    });
    const initialSelectionListenerCount = addDocumentListener.mock.calls
      .filter(([type]) => type === "selectionchange").length;
    const initialMouseDownListenerCount = addDocumentListener.mock.calls
      .filter(([type]) => type === "mousedown").length;

    await act(async () => {
      root?.render(
        <>
          {Array.from({ length: 50 }, (_, index) => (
            <AssistantSelectionContent
              key={index}
              content={`assistant message ${index}`}
              displayPreferences={displayPreferences}
              enabled
            />
          ))}
        </>
      );
    });

    expect(addDocumentListener.mock.calls.filter(([type]) => type === "selectionchange")).toHaveLength(initialSelectionListenerCount);
    expect(addDocumentListener.mock.calls.filter(([type]) => type === "mousedown")).toHaveLength(initialMouseDownListenerCount);
  });

  it("mounts selection listeners only while selected text is active", async () => {
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const onSelectionChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={displayPreferences}
          enabled
          onSelectionChange={onSelectionChange}
        />
      );
    });
    const initialSelectionListenerCount = addDocumentListener.mock.calls
      .filter(([type]) => type === "selectionchange").length;
    const initialMouseDownListenerCount = addDocumentListener.mock.calls
      .filter(([type]) => type === "mousedown").length;

    const selectionContainer = container.querySelector<HTMLElement>(".assistant-selection-content");
    const textNode = container.querySelector<HTMLElement>(".bubble-plain-text")?.firstChild;
    expect(selectionContainer).toBeTruthy();
    expect(textNode).toBeTruthy();
    defineRect(selectionContainer!, { width: 300, right: 300 });
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, 10);
    defineRect(range, { left: 10, right: 90, width: 80, bottom: 24 });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    await act(async () => {
      selectionContainer!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      text: "selectable",
      location: "line 1:1 to line 1:11"
    });
    expect(container.querySelector(".selection-thread-affordance")).not.toBeNull();
    expect(addDocumentListener.mock.calls.filter(([type]) => type === "selectionchange").length).toBeGreaterThan(initialSelectionListenerCount);
    expect(addDocumentListener.mock.calls.filter(([type]) => type === "mousedown").length).toBeGreaterThan(initialMouseDownListenerCount);

    await act(async () => {
      selection?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    expect(removeDocumentListener.mock.calls.filter(([type]) => type === "selectionchange").length).toBeGreaterThan(0);
    expect(removeDocumentListener.mock.calls.filter(([type]) => type === "mousedown").length).toBeGreaterThan(0);
  });

  it("renders text action buttons for Annotate, Quote, and Ask in thread", async () => {
    const onQuoteSelection = vi.fn();
    const onAskSelectionInThread = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={displayPreferences}
          enabled
          onQuoteSelection={onQuoteSelection}
          onAskSelectionInThread={onAskSelectionInThread}
        />
      );
    });

    await selectText(container, 0, 10);

    const annotateButton = container.querySelector<HTMLButtonElement>("[aria-label='Annotate selected text']");
    const quoteButton = container.querySelector<HTMLButtonElement>("[aria-label='Quote selected text']");
    const threadButton = container.querySelector<HTMLButtonElement>("[aria-label='Ask in thread']");
    expect(annotateButton).toBeTruthy();
    expect(annotateButton?.textContent).toBe("Annotate");
    expect(quoteButton).toBeTruthy();
    expect(quoteButton?.textContent).toBe("Quote");
    expect(threadButton).toBeTruthy();
    expect(threadButton?.textContent).toBe("Ask in thread");

    await act(async () => {
      quoteButton?.click();
    });
    expect(onQuoteSelection).toHaveBeenCalledWith({
      text: "selectable",
      location: "line 1:1 to line 1:11"
    });

    await selectText(container, 11, 20);
    await act(async () => {
      container!.querySelector<HTMLButtonElement>("[aria-label='Ask in thread']")?.click();
    });
    expect(onAskSelectionInThread).toHaveBeenCalledWith({
      text: "assistant",
      location: "line 1:12 to line 1:21"
    });
  });

  it("opens annotation card when clicking Annotate and saves comment with quote", async () => {
    const onQuoteSelection = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={displayPreferences}
          enabled
          annotationIndex={3}
          onQuoteSelection={onQuoteSelection}
        />
      );
    });

    await selectText(container, 0, 10);

    const annotateButton = container.querySelector<HTMLButtonElement>("[aria-label='Annotate selected text']");
    expect(annotateButton).toBeTruthy();

    await act(async () => {
      annotateButton?.click();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(".selection-annotation-card textarea");
    const badge = container.querySelector<HTMLElement>(".selection-annotation-badge");
    const saveButton = container.querySelector<HTMLButtonElement>(".selection-annotation-action-btn.save");
    expect(textarea).toBeTruthy();
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe("3");
    expect(saveButton?.disabled).toBe(true);

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeSetter?.call(textarea, "yes, so you should do this");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
    });

    expect(onQuoteSelection).toHaveBeenCalledWith({
      text: "selectable",
      location: "line 1:1 to line 1:11",
      comment: "yes, so you should do this"
    });
  });

  it("discards annotation when clicking cancel or discard button", async () => {
    const onQuoteSelection = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={displayPreferences}
          enabled
          onQuoteSelection={onQuoteSelection}
        />
      );
    });

    await selectText(container, 0, 10);
    await act(async () => {
      container!.querySelector<HTMLButtonElement>("[aria-label='Annotate selected text']")?.click();
    });

    expect(container.querySelector(".selection-annotation-card")).toBeTruthy();

    await act(async () => {
      container!.querySelector<HTMLButtonElement>(".selection-annotation-action-btn.cancel")?.click();
    });

    expect(container.querySelector(".selection-annotation-card")).toBeNull();
    expect(onQuoteSelection).not.toHaveBeenCalled();
  });

  it("saves annotation when pressing Enter without shift", async () => {
    const onQuoteSelection = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={displayPreferences}
          enabled
          onQuoteSelection={onQuoteSelection}
        />
      );
    });

    await selectText(container, 0, 10);
    await act(async () => {
      container!.querySelector<HTMLButtonElement>("[aria-label='Annotate selected text']")?.click();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(".selection-annotation-card textarea");
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeSetter?.call(textarea, "keyboard save note");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onQuoteSelection).toHaveBeenCalledWith({
      text: "selectable",
      location: "line 1:1 to line 1:11",
      comment: "keyboard save note"
    });
  });



  it("keeps exact thread anchor geometry while hiding its highlight", async () => {
    const onOpenSelectionThreads = vi.fn();
    const originalCreateRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = originalCreateRange();
      Object.defineProperty(range, "getClientRects", {
        configurable: true,
        value: () => [{
          x: 12,
          y: 40,
          top: 40,
          bottom: 60,
          left: 12,
          right: 100,
          width: 88,
          height: 20,
          toJSON: () => undefined
        }]
      });
      return range;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      bottom: 200,
      left: 0,
      right: 300,
      width: 300,
      height: 200,
      toJSON: () => undefined
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const threadAnchors = [{
      text: "assistant",
      location: "line 1:12 to line 1:21",
      threads: [{
        task_id: "thread-1",
        parent_message_id: "message-1",
        title: "Follow-up",
        status: "completed",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:00:00.000Z",
        selected_text: "assistant",
        selected_text_location: "line 1:12 to line 1:21",
        latest_assistant_preview: null
      }]
    }];

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={{ ...displayPreferences, showSelectionThreadHighlights: false }}
          enabled
          threadAnchors={threadAnchors}
          onOpenSelectionThreads={onOpenSelectionThreads}
        />
      );
    });

    const anchor = container.querySelector<HTMLButtonElement>(".assistant-thread-anchor");
    expect(anchor?.dataset.threadAnchorText).toBe("assistant");
    expect(anchor?.dataset.threadAnchorLocation).toBe("line 1:12 to line 1:21");
    expect(anchor?.classList.contains("is-hidden")).toBe(true);
    expect(anchor?.getAttribute("aria-hidden")).toBe("true");
    expect(anchor?.tabIndex).toBe(-1);

    await act(async () => {
      anchor?.click();
    });
    expect(onOpenSelectionThreads).not.toHaveBeenCalled();
  });

  it("opens an inline thread composer when typing with selected text active", async () => {
    const onSubmitSelectionThread = vi.fn(async () => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={displayPreferences}
          enabled
          onSubmitSelectionThread={onSubmitSelectionThread}
        />
      );
    });

    await selectText(container, 0, 10);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(".selection-inline-thread-composer textarea");
    expect(textarea?.value).toBe("w");

    await act(async () => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(container.querySelector<HTMLTextAreaElement>(".selection-inline-thread-composer textarea")?.value).toBe("w");

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onSubmitSelectionThread).toHaveBeenCalledWith(
      {
        text: "selectable",
        location: "line 1:1 to line 1:11"
      },
      "w"
    );
  });

  it("opens the inline thread composer even when another input has focus", async () => {
    container = document.createElement("div");
    const externalInput = document.createElement("input");
    document.body.appendChild(externalInput);
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AssistantSelectionContent
          content="selectable assistant text"
          displayPreferences={displayPreferences}
          enabled
        />
      );
    });

    externalInput.focus();
    await selectText(container, 0, 10);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      externalInput.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    });

    expect(container.querySelector<HTMLTextAreaElement>(".selection-inline-thread-composer textarea")?.value).toBe("w");
    externalInput.remove();
  });
});
