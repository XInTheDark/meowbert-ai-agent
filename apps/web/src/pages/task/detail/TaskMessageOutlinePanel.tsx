import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { MessageSquareText, X } from "lucide-react";
import type { TaskMessage } from "../../../lib/types";
import {
  buildTaskMessageOutlineItems,
  getTaskMessageOutlineScrollTopForIndex,
  getTaskMessageOutlineVirtualWindow,
  resolveActiveOutlineMessageId,
  TASK_MESSAGE_OUTLINE_ROW_HEIGHT,
  type TaskMessageOutlineItem
} from "./taskMessageOutlineUtils";

interface TaskMessageOutlinePanelProps {
  messages: TaskMessage[];
  chatFeedRef: RefObject<HTMLDivElement>;
  isMobileDrawer: boolean;
  onMessageRequested: (messageId: string) => void;
  onClose?: () => void;
}

interface TaskMessageOutlinePreviewState {
  item: TaskMessageOutlineItem;
  anchorRect: DOMRect;
}

function getPreviewPopoverStyle(preview: TaskMessageOutlinePreviewState | null): CSSProperties | undefined {
  if (!preview || typeof window === "undefined") {
    return undefined;
  }

  const preferredWidth = 320;
  const minWidth = 220;
  const gap = 14;
  const viewportPadding = 16;
  const availableRightWidth = window.innerWidth - preview.anchorRect.right - gap - viewportPadding;
  const canPlaceRight = availableRightWidth >= minWidth;
  const width = Math.max(
    minWidth,
    Math.min(preferredWidth, canPlaceRight ? availableRightWidth : preview.anchorRect.left - gap - viewportPadding)
  );
  const left = canPlaceRight
    ? Math.min(window.innerWidth - width - viewportPadding, preview.anchorRect.right + gap)
    : Math.max(viewportPadding, preview.anchorRect.left - gap - width);
  const top = Math.max(
    viewportPadding,
    Math.min(window.innerHeight - 220, preview.anchorRect.top - 4)
  );

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  };
}

function useActiveOutlineMessageId(
  feedRef: RefObject<HTMLDivElement>,
  outlineItemIdSet: Set<string>
): string | null {
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || outlineItemIdSet.size === 0) {
      setActiveMessageId(null);
      return;
    }

    let frameId = 0;
    const updateActiveMessage = () => {
      frameId = 0;
      setActiveMessageId((current) => {
        const nextValue = resolveActiveOutlineMessageId(feed, outlineItemIdSet);
        return current === nextValue ? current : nextValue;
      });
    };
    const scheduleUpdate = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(updateActiveMessage);
    };

    scheduleUpdate();
    feed.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    if (typeof MutationObserver === "function") {
      const mutationObserver = new MutationObserver(scheduleUpdate);
      mutationObserver.observe(feed, { childList: true, subtree: true });
      return () => {
        feed.removeEventListener("scroll", scheduleUpdate);
        window.removeEventListener("resize", scheduleUpdate);
        mutationObserver.disconnect();
        if (frameId !== 0) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }

    return () => {
      feed.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [feedRef, outlineItemIdSet]);

  return activeMessageId;
}

export function TaskMessageOutlinePanel(props: TaskMessageOutlinePanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => buildTaskMessageOutlineItems(props.messages), [props.messages]);
  const outlineItemIdSet = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const observedActiveMessageId = useActiveOutlineMessageId(props.chatFeedRef, outlineItemIdSet);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(items[0]?.id ?? null);
  const [lockedMessageId, setLockedMessageId] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<TaskMessageOutlinePreviewState | null>(null);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const activeMessageId = lockedMessageId ?? observedActiveMessageId ?? selectedMessageId;
  const previewPopoverStyle = useMemo(() => getPreviewPopoverStyle(hoverPreview), [hoverPreview]);
  const virtualWindow = useMemo(() => getTaskMessageOutlineVirtualWindow({
    scrollTop: listScrollTop,
    viewportHeight: listViewportHeight,
    totalItems: items.length
  }), [items.length, listScrollTop, listViewportHeight]);
  const visibleItems = useMemo(
    () => items.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [items, virtualWindow.endIndex, virtualWindow.startIndex]
  );

  useEffect(() => {
    if (observedActiveMessageId) {
      setSelectedMessageId(observedActiveMessageId);
    }
  }, [observedActiveMessageId]);

  useEffect(() => {
    if (!lockedMessageId) {
      return;
    }

    if (observedActiveMessageId === lockedMessageId) {
      setLockedMessageId(null);
    }
  }, [lockedMessageId, observedActiveMessageId]);

  useEffect(() => {
    if (!lockedMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLockedMessageId((current) => (current === lockedMessageId ? null : current));
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [lockedMessageId]);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedMessageId(null);
      setLockedMessageId(null);
      return;
    }

    setSelectedMessageId((current) => (
      current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null
    ));
    setLockedMessageId((current) => (
      current && items.some((item) => item.id === current) ? current : null
    ));
  }, [items]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const updateMeasurements = () => {
      setListViewportHeight(list.clientHeight);
      setListScrollTop(list.scrollTop);
    };
    const handleScroll = () => {
      setListScrollTop(list.scrollTop);
      setHoverPreview(null);
    };

    updateMeasurements();
    list.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updateMeasurements);

    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(updateMeasurements);
      resizeObserver.observe(list);
      return () => {
        list.removeEventListener("scroll", handleScroll);
        window.removeEventListener("resize", updateMeasurements);
        resizeObserver.disconnect();
      };
    }

    return () => {
      list.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateMeasurements);
    };
  }, []);

  useEffect(() => {
    if (!activeMessageId) {
      return;
    }

    const list = listRef.current;
    if (!list) {
      return;
    }

    const activeIndex = items.findIndex((item) => item.id === activeMessageId);
    if (activeIndex < 0) {
      return;
    }

    const rowTop = getTaskMessageOutlineScrollTopForIndex(activeIndex);
    const rowBottom = rowTop + TASK_MESSAGE_OUTLINE_ROW_HEIGHT;
    const viewportTop = list.scrollTop;
    const viewportBottom = viewportTop + list.clientHeight;

    if (rowTop < viewportTop) {
      list.scrollTo({ top: rowTop, behavior: "auto" });
      return;
    }

    if (rowBottom > viewportBottom) {
      list.scrollTo({
        top: Math.max(0, rowBottom - list.clientHeight),
        behavior: "auto"
      });
    }
  }, [activeMessageId, items]);

  useEffect(() => {
    if (!hoverPreview) {
      return;
    }

    const clearPreview = () => setHoverPreview(null);
    window.addEventListener("resize", clearPreview);
    window.addEventListener("scroll", clearPreview, true);

    return () => {
      window.removeEventListener("resize", clearPreview);
      window.removeEventListener("scroll", clearPreview, true);
    };
  }, [hoverPreview]);

  return (
    <aside className={`task-message-outline${props.isMobileDrawer ? " mobile-drawer" : ""}`}>
      <div className="task-message-outline-header">
        <div className="task-message-outline-header-text">
          <strong><MessageSquareText size={15} /> Messages</strong>
          <span className="task-message-outline-count">{items.length} items</span>
        </div>
        {props.isMobileDrawer && props.onClose ? (
          <button
            type="button"
            className="task-message-outline-close-btn"
            onClick={props.onClose}
            aria-label="Hide messages panel"
            title="Hide messages panel"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      <div className="task-message-outline-list" ref={listRef}>
        {items.length === 0 ? <p className="muted-text">No messages yet.</p> : null}
        {items.length > 0 ? (
          <div
            className="task-message-outline-virtual-track"
            style={{ height: `${virtualWindow.totalHeight}px` }}
          >
            {visibleItems.map((item, visibleIndex) => {
              const absoluteIndex = virtualWindow.startIndex + visibleIndex;
              return (
                <div
                  key={item.id}
                  className="task-message-outline-item-row"
                  style={{ transform: `translateY(${absoluteIndex * TASK_MESSAGE_OUTLINE_ROW_HEIGHT}px)` }}
                >
                  <button
                    type="button"
                    className={`task-message-outline-item${item.id === activeMessageId ? " active" : ""}`}
                    data-outline-item-id={item.id}
                    onClick={() => {
                      setHoverPreview(null);
                      setLockedMessageId(item.id);
                      setSelectedMessageId(item.id);
                      props.onMessageRequested(item.id);
                    }}
                    onMouseEnter={(event) => {
                      if (props.isMobileDrawer) {
                        return;
                      }

                      setHoverPreview({
                        item,
                        anchorRect: event.currentTarget.getBoundingClientRect()
                      });
                    }}
                    onMouseLeave={() => setHoverPreview((current) => (current?.item.id === item.id ? null : current))}
                    onFocus={(event) => {
                      if (props.isMobileDrawer) {
                        return;
                      }

                      setHoverPreview({
                        item,
                        anchorRect: event.currentTarget.getBoundingClientRect()
                      });
                    }}
                    onBlur={() => setHoverPreview((current) => (current?.item.id === item.id ? null : current))}
                  >
                    <span className={`task-message-outline-role task-message-outline-role-${item.role}`}>
                      {item.role === "assistant" ? "A" : "U"}
                    </span>
                    <span className="task-message-outline-item-main">
                      <span className="task-message-outline-item-meta">
                        <span className="task-message-outline-item-index">#{item.index}</span>
                        <span className="task-message-outline-item-label">{item.label}</span>
                      </span>
                      <span className="task-message-outline-item-preview" title={item.preview}>
                        {item.preview}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {hoverPreview && previewPopoverStyle ? (
        <div
          className="task-message-outline-preview-popover"
          style={previewPopoverStyle}
          aria-hidden="true"
        >
          <div className="task-message-outline-preview-popover-meta">
            <span>#{hoverPreview.item.index}</span>
            <span>{hoverPreview.item.label}</span>
          </div>
          <div className="task-message-outline-preview-popover-text">
            {hoverPreview.item.hoverPreview}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
