import { useEffect, type RefObject } from "react";

const BOTTOM_EDGE_TOLERANCE_PX = 2;
const TOUCH_SCROLL_THRESHOLD_PX = 8;

function findScrollContainer(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") {
      return parent;
    }
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function isAtBottomWithElementVisible(container: HTMLElement, element: HTMLElement): boolean {
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (distanceFromBottom > BOTTOM_EDGE_TOLERANCE_PX) {
    return false;
  }
  const visibleBottom = container === document.scrollingElement
    ? window.innerHeight
    : container.getBoundingClientRect().bottom;
  return element.getBoundingClientRect().bottom <= visibleBottom + BOTTOM_EDGE_TOLERANCE_PX;
}

// Expands a collapsed message when the user keeps scrolling down after reaching
// the bottom of the feed with that message's end in view (i.e. it is the last message).
export function useExpandOnBottomOverscroll(
  anchorRef: RefObject<HTMLElement>,
  enabled: boolean,
  onExpand: () => void
): void {
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!enabled || !anchor) {
      return;
    }

    const container = findScrollContainer(anchor);
    let touchStartY: number | null = null;
    const expandIfAtBottom = (): void => {
      if (isAtBottomWithElementVisible(container, anchor)) {
        onExpand();
      }
    };
    const handleWheel = (event: WheelEvent): void => {
      if (event.deltaY > 0) {
        expandIfAtBottom();
      }
    };
    const handleTouchStart = (event: TouchEvent): void => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent): void => {
      const currentY = event.touches[0]?.clientY;
      if (touchStartY !== null && currentY !== undefined && touchStartY - currentY > TOUCH_SCROLL_THRESHOLD_PX) {
        touchStartY = null;
        expandIfAtBottom();
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
    };
  }, [anchorRef, enabled, onExpand]);
}
