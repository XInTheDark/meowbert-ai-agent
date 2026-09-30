import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Send, X } from "lucide-react";
import type { TaskAssistantMessageDisplayPreferences, TaskThreadSummary } from "../../lib/types";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { formatSelectedTextLocation, type SelectedTextLocation, type SelectedTextQuote } from "./selectedTextQuoteUtils";
import { SelectionFloatingMenu } from "./SelectionFloatingMenu";
import { SelectionAnnotationCard } from "./SelectionAnnotationCard";

interface SelectedTextThreadAnchor extends SelectedTextQuote {
  threads: TaskThreadSummary[];
}

interface ThreadAnchorRect {
  key: string;
  quote: SelectedTextQuote;
  threads: TaskThreadSummary[];
  style: CSSProperties;
}

interface AffordancePosition {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

const LOCATION_PATTERN = /^line (\d+):(\d+) to line (\d+):(\d+)$/;

function isSelectionInside(root: HTMLElement, node: Node | null): boolean {
  if (!node) {
    return false;
  }

  return root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
}

function resolveTextOffset(container: HTMLElement, node: Node, offset: number): number | null {
  const range = document.createRange();
  try {
    range.selectNodeContents(container);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  } finally {
    range.detach();
  }
}

function isThreadAnchorMatch(anchor: SelectedTextThreadAnchor): boolean {
  return anchor.text.trim().length > 0 && anchor.threads.length > 0;
}

function parseSelectedTextLocation(location: string | null): SelectedTextLocation | null {
  if (!location) {
    return null;
  }

  const match = LOCATION_PATTERN.exec(location);
  if (!match) {
    return null;
  }

  return {
    startLine: Number(match[1]),
    startColumn: Number(match[2]),
    endLine: Number(match[3]),
    endColumn: Number(match[4])
  };
}

function resolveOffsetFromLineColumn(text: string, line: number, column: number): number {
  const lines = text.split(/\r?\n/);
  const lineIndex = Math.max(0, Math.min(line - 1, lines.length - 1));
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }

  return offset + Math.max(0, Math.min(column - 1, lines[lineIndex]?.length ?? 0));
}

function resolveTextNodePosition(root: HTMLElement, targetOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, targetOffset);
  let current = walker.nextNode();

  while (current) {
    const textNode = current as Text;
    const length = textNode.data.length;
    if (remaining <= length) {
      return {
        node: textNode,
        offset: remaining
      };
    }

    remaining -= length;
    current = walker.nextNode();
  }

  return null;
}

function resolveRangeFromOffsets(root: HTMLElement, startOffset: number, endOffset: number): Range | null {
  const start = resolveTextNodePosition(root, startOffset);
  const end = resolveTextNodePosition(root, endOffset);
  if (!start || !end) {
    return null;
  }

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function resolveAnchorRange(root: HTMLElement, anchor: SelectedTextThreadAnchor): Range | null {
  const fullText = root.innerText || root.textContent || "";
  const location = parseSelectedTextLocation(anchor.location);
  if (location) {
    return resolveRangeFromOffsets(
      root,
      resolveOffsetFromLineColumn(fullText, location.startLine, location.startColumn),
      resolveOffsetFromLineColumn(fullText, location.endLine, location.endColumn)
    );
  }

  const textIndex = fullText.indexOf(anchor.text.trim());
  if (textIndex < 0) {
    return null;
  }

  return resolveRangeFromOffsets(root, textIndex, textIndex + anchor.text.trim().length);
}

function buildThreadAnchorRects(
  root: HTMLElement,
  anchors: SelectedTextThreadAnchor[]
): ThreadAnchorRect[] {
  const rootRect = root.getBoundingClientRect();
  const nextRects: ThreadAnchorRect[] = [];

  anchors.filter(isThreadAnchorMatch).forEach((anchor, anchorIndex) => {
    const range = resolveAnchorRange(root, anchor);
    if (!range) {
      return;
    }

    Array.from(range.getClientRects()).forEach((rect, rectIndex) => {
      if (rect.width < 1 || rect.height < 1) {
        return;
      }

      nextRects.push({
        key: `${anchor.location ?? anchor.text}:${anchorIndex}:${rectIndex}`,
        quote: {
          text: anchor.text,
          location: anchor.location
        },
        threads: anchor.threads,
        style: {
          left: `${rect.left - rootRect.left}px`,
          top: `${rect.top - rootRect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`
        }
      });
    });

    range.detach();
  });

  return nextRects;
}

function resolveLineColumn(text: string, offset: number): { line: number; column: number } {
  const beforeOffset = text.slice(0, offset);
  const lines = beforeOffset.split(/\r?\n/);

  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1
  };
}

function resolveSelectedTextLocation(container: HTMLElement, range: Range): SelectedTextLocation | null {
  const fullText = container.innerText || container.textContent || "";
  const startOffset = resolveTextOffset(container, range.startContainer, range.startOffset);
  const endOffset = resolveTextOffset(container, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) {
    return null;
  }

  const start = resolveLineColumn(fullText, Math.max(0, Math.min(startOffset, fullText.length)));
  const end = resolveLineColumn(fullText, Math.max(0, Math.min(endOffset, fullText.length)));

  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column
  };
}

export function AssistantSelectionContent(props: {
  content: string;
  displayPreferences: TaskAssistantMessageDisplayPreferences;
  enabled: boolean;
  annotationIndex?: number;
  onSelectionChange?: (selectedText: SelectedTextQuote | null) => void;
  onQuoteSelection?: (selectedText: SelectedTextQuote) => void;
  onAskSelectionInThread?: (selectedText: SelectedTextQuote) => void;
  onOpenSelectionThreads?: (selectedText: SelectedTextQuote) => void;
  onSubmitSelectionThread?: (selectedText: SelectedTextQuote, message: string) => void | Promise<void>;
  threadAnchors?: SelectedTextThreadAnchor[];
  forceExpanded?: boolean;
  expansionKey?: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const affordanceRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLTextAreaElement>(null);
  const preserveSelectionForInlineComposerRef = useRef(false);
  const [selectedText, setSelectedText] = useState<SelectedTextQuote | null>(null);
  const [affordancePosition, setAffordancePosition] = useState<AffordancePosition>({ top: 0, left: 0, placement: "top" });
  const [inlineDraft, setInlineDraft] = useState("");
  const [isAnnotationOpen, setIsAnnotationOpen] = useState(false);
  const [isInlineComposerOpen, setIsInlineComposerOpen] = useState(false);
  const [isInlineSubmitting, setIsInlineSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [threadAnchorRects, setThreadAnchorRects] = useState<ThreadAnchorRect[]>([]);

  const clearSelection = useCallback((): void => {
    preserveSelectionForInlineComposerRef.current = false;
    setSelectedText(null);
    setInlineDraft("");
    setIsAnnotationOpen(false);
    setIsInlineComposerOpen(false);
    setInlineError(null);
    props.onSelectionChange?.(null);
  }, [props.onSelectionChange]);

  const refreshSelection = useCallback((): void => {
    const selection = window.getSelection();
    const container = containerRef.current;
    if (!selection || !container || selection.rangeCount === 0 || selection.isCollapsed) {
      if (preserveSelectionForInlineComposerRef.current) {
        return;
      }
      clearSelection();
      return;
    }

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const content = contentRef.current;
    if (
      text.length === 0
      || !content
      || !isSelectionInside(content, range.startContainer)
      || !isSelectionInside(content, range.endContainer)
    ) {
      if (preserveSelectionForInlineComposerRef.current) {
        return;
      }
      clearSelection();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    const centerX = (rangeRect.left + rangeRect.right) / 2 - containerRect.left;
    const clampedX = Math.max(10, Math.min(centerX, containerRect.width - 10));
    const isCloseToTop = rangeRect.top - containerRect.top < 48;
    const placement: "top" | "bottom" = isCloseToTop ? "bottom" : "top";
    const targetY = placement === "top"
      ? Math.max(0, rangeRect.top - containerRect.top - 8)
      : Math.max(0, rangeRect.bottom - containerRect.top + 8);

    setAffordancePosition({
      top: targetY,
      left: clampedX,
      placement
    });

    const nextSelection = {
      text,
      location: formatSelectedTextLocation(resolveSelectedTextLocation(content, range))
    };
    preserveSelectionForInlineComposerRef.current = false;
    setSelectedText(nextSelection);
    setInlineError(null);
    props.onSelectionChange?.(nextSelection);
  }, [clearSelection, props.onSelectionChange]);

  const handleDocumentMouseDown = useCallback((event: MouseEvent): void => {
    const container = containerRef.current;
    const affordance = affordanceRef.current;
    if (
      !container
      || (!container.contains(event.target as Node) && !affordance?.contains(event.target as Node))
    ) {
      clearSelection();
    }
  }, [clearSelection]);

  const dismissNativeSelection = useCallback((): void => {
    window.getSelection()?.removeAllRanges();
    clearSelection();
  }, [clearSelection]);

  const handleOpenAnnotation = useCallback((): void => {
    preserveSelectionForInlineComposerRef.current = true;
    setIsAnnotationOpen(true);
  }, []);

  const handleSaveAnnotation = useCallback((comment: string): void => {
    if (!selectedText) {
      return;
    }

    props.onQuoteSelection?.({
      text: selectedText.text,
      location: selectedText.location,
      comment
    });
    dismissNativeSelection();
  }, [dismissNativeSelection, props, selectedText]);

  const handleQuoteSelection = useCallback((): void => {
    if (!selectedText) {
      return;
    }

    props.onQuoteSelection?.(selectedText);
    dismissNativeSelection();
  }, [dismissNativeSelection, props, selectedText]);

  const handleAskSelectionInThread = useCallback((): void => {
    if (!selectedText) {
      return;
    }

    props.onAskSelectionInThread?.(selectedText);
    dismissNativeSelection();
  }, [dismissNativeSelection, props, selectedText]);

  const handleInlineSubmit = useCallback(async (): Promise<void> => {
    if (!selectedText || !inlineDraft.trim() || isInlineSubmitting) {
      return;
    }

    setIsInlineSubmitting(true);
    setInlineError(null);
    try {
      await props.onSubmitSelectionThread?.(selectedText, inlineDraft);
      dismissNativeSelection();
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInlineSubmitting(false);
    }
  }, [dismissNativeSelection, inlineDraft, isInlineSubmitting, props, selectedText]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      setThreadAnchorRects([]);
      return;
    }

    setThreadAnchorRects(buildThreadAnchorRects(content, props.threadAnchors ?? []));
  }, [props.content, props.displayPreferences.hideCitationMarkers, props.forceExpanded, props.threadAnchors]);

  useEffect(() => {
    if (isInlineComposerOpen) {
      inlineInputRef.current?.focus();
    }
  }, [isInlineComposerOpen]);

  useEffect(() => {
    if (!props.enabled || typeof window === "undefined") {
      clearSelection();
      return;
    }

    if (!selectedText) {
      return;
    }

    document.addEventListener("selectionchange", refreshSelection);
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("selectionchange", refreshSelection);
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [clearSelection, handleDocumentMouseDown, props.enabled, refreshSelection, selectedText]);

  useEffect(() => {
    if (!props.enabled || !selectedText || isInlineComposerOpen || isAnnotationOpen) {
      return;
    }

    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.altKey
      ) {
        return;
      }

      if (event.key.length !== 1) {
        return;
      }

      event.preventDefault();
      preserveSelectionForInlineComposerRef.current = true;
      setInlineDraft(event.key);
      setIsInlineComposerOpen(true);
      setInlineError(null);
    }

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [isAnnotationOpen, isInlineComposerOpen, props.enabled, selectedText]);

  return (
    <div
      ref={containerRef}
      className="assistant-selection-content"
      onKeyUp={props.enabled ? refreshSelection : undefined}
      onMouseUp={props.enabled ? refreshSelection : undefined}
      onTouchEnd={props.enabled ? refreshSelection : undefined}
    >
      <div ref={contentRef} className="assistant-selection-content-main">
        <ConversationMessageContent
          content={props.content}
          displayPreferences={props.displayPreferences}
          enableLongMessageCollapse
          forceExpanded={props.forceExpanded}
          expansionKey={props.expansionKey}
        />
        {threadAnchorRects.length > 0 ? (
          <div className="assistant-thread-anchor-overlays" aria-hidden={false}>
            {threadAnchorRects.map((rect) => (
              <button
                key={rect.key}
                type="button"
                className={`assistant-thread-anchor${props.displayPreferences.showSelectionThreadHighlights ? "" : " is-hidden"}`}
                style={rect.style}
                data-thread-anchor-text={rect.quote.text.trim()}
                data-thread-anchor-location={rect.quote.location ?? undefined}
                onClick={props.displayPreferences.showSelectionThreadHighlights
                  ? () => props.onOpenSelectionThreads?.(rect.quote)
                  : undefined}
                aria-hidden={!props.displayPreferences.showSelectionThreadHighlights}
                tabIndex={props.displayPreferences.showSelectionThreadHighlights ? 0 : -1}
                aria-label={`Open ${rect.threads.length} selected text thread${rect.threads.length === 1 ? "" : "s"}`}
                title={`Open ${rect.threads.length} selected text thread${rect.threads.length === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        ) : null}
      </div>
      {props.enabled && selectedText ? (
        <div
          ref={affordanceRef}
          className={`selection-thread-affordance${isInlineComposerOpen ? " has-inline-composer" : ""}${isAnnotationOpen ? " has-annotation-card" : ""}`}
          style={{
            top: `${affordancePosition.top}px`,
            left: `${affordancePosition.left}px`,
            transform: affordancePosition.placement === "top"
              ? "translate(-50%, -100%)"
              : "translate(-50%, 0)"
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {isAnnotationOpen ? (
            <div className="selection-annotation-wrapper">
              <div className="selection-annotation-badge" aria-hidden="true">{props.annotationIndex ?? 1}</div>
              <SelectionAnnotationCard
                onSave={handleSaveAnnotation}
                onDiscard={clearSelection}
              />
            </div>
          ) : isInlineComposerOpen ? (
            <form
              className="selection-inline-thread-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void handleInlineSubmit();
              }}
            >
              <textarea
                ref={inlineInputRef}
                value={inlineDraft}
                onChange={(event) => setInlineDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    clearSelection();
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleInlineSubmit();
                  }
                }}
                placeholder="Ask in thread..."
                rows={2}
                disabled={isInlineSubmitting}
              />
              <div className="selection-inline-thread-actions">
                <button
                  type="button"
                  className="selection-affordance-button"
                  onClick={clearSelection}
                  aria-label="Close thread input"
                  title="Close"
                  disabled={isInlineSubmitting}
                >
                  <X size={14} />
                </button>
                <button
                  type="submit"
                  className="selection-affordance-button primary"
                  aria-label="Send thread"
                  title="Send"
                  disabled={isInlineSubmitting || inlineDraft.trim().length === 0}
                >
                  <Send size={14} />
                </button>
              </div>
              {inlineError ? <p className="selection-inline-thread-error">{inlineError}</p> : null}
            </form>
          ) : (
            <SelectionFloatingMenu
              onAnnotate={handleOpenAnnotation}
              onQuote={handleQuoteSelection}
              onAskInThread={handleAskSelectionInThread}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
