import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const EDGE_MARGIN = 12;
const RAIL_GAP = 12;
const MAX_RAIL_WIDTH = 80;

interface Bounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function isScrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return /(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`);
}

function resolveVisibleBounds(anchor: HTMLElement): Bounds {
  const bounds: Bounds = { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 };
  let parent = anchor.parentElement;
  while (parent && parent !== document.body) {
    if (isScrollable(parent)) {
      const rect = parent.getBoundingClientRect();
      const innerLeft = rect.left + parent.clientLeft;
      const innerTop = rect.top + parent.clientTop;
      bounds.top = Math.max(bounds.top, innerTop);
      bounds.right = Math.min(bounds.right, innerLeft + parent.clientWidth);
      bounds.bottom = Math.min(bounds.bottom, innerTop + parent.clientHeight);
      bounds.left = Math.max(bounds.left, innerLeft);
    }
    parent = parent.parentElement;
  }
  return bounds;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Places the selection actions in a fixed rail just right of the message column,
 * level with the selection. It only slides over the text when the visible area
 * has no room to the right, and it never leaves the visible scroll area.
 */
export function useSelectionAffordancePosition(params: {
  anchorRef: RefObject<HTMLElement>;
  affordanceRef: RefObject<HTMLElement>;
  range: Range | null;
  layoutKey: string;
}): CSSProperties {
  const { anchorRef, affordanceRef, range, layoutKey } = params;
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  const update = useCallback((): void => {
    const anchor = anchorRef.current;
    const affordance = affordanceRef.current;
    if (!anchor || !affordance || !range) {
      return;
    }

    const bounds = resolveVisibleBounds(anchor);
    const anchorRect = anchor.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    const width = affordance.offsetWidth;
    const height = affordance.offsetHeight;
    const isOutOfView = rangeRect.bottom < bounds.top || rangeRect.top > bounds.bottom;

    const left = clamp(anchorRect.right + RAIL_GAP, bounds.left + EDGE_MARGIN, bounds.right - EDGE_MARGIN - width);
    // A wide panel squeezed over the text would hide the selection, so it drops below it instead.
    const coversSelection = width > MAX_RAIL_WIDTH && left < rangeRect.right;
    const preferredTop = coversSelection ? rangeRect.bottom + RAIL_GAP : rangeRect.top;

    setStyle({
      top: clamp(preferredTop, bounds.top + EDGE_MARGIN, bounds.bottom - EDGE_MARGIN - height),
      left,
      visibility: isOutOfView ? "hidden" : "visible"
    });
  }, [affordanceRef, anchorRef, range]);

  useLayoutEffect(() => {
    update();
  }, [layoutKey, update]);

  useEffect(() => {
    if (!range) {
      return;
    }

    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [range, update]);

  return style;
}
