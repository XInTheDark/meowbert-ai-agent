import { useLayoutEffect, useState, type RefObject } from "react";

export interface AnchoredMenuPosition {
  left: number;
  top: number;
}

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;

/**
 * Places a body-portaled menu under its anchor's right edge (or above it when there is no room below),
 * so the menu is never clipped by a scrolling or overflow-hidden ancestor.
 */
export function useAnchoredMenuPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>
): AnchoredMenuPosition | null {
  const [position, setPosition] = useState<AnchoredMenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function reposition(): void {
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchorRect || !menu) {
        return;
      }

      const maxLeft = window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(anchorRect.right - menu.offsetWidth, maxLeft));
      const belowTop = anchorRect.bottom + MENU_GAP;
      const aboveTop = anchorRect.top - MENU_GAP - menu.offsetHeight;
      const fitsBelow = belowTop + menu.offsetHeight <= window.innerHeight - VIEWPORT_MARGIN;
      setPosition({ left, top: fitsBelow ? belowTop : Math.max(VIEWPORT_MARGIN, aboveTop) });
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, anchorRef, menuRef]);

  return position;
}
