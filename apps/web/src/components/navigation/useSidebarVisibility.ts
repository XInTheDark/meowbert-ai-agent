import { useCallback, useEffect, useRef, useState } from "react";

const PINNED_KEY = "meowbert_sidebar_pinned";
// Long enough to cross the gap between the toggle and the sidebar without it closing.
const PEEK_CLOSE_DELAY_MS = 200;

function readPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

function writePinned(pinned: boolean): void {
  try {
    localStorage.setItem(PINNED_KEY, pinned ? "1" : "0");
  } catch {
    // Storage can be unavailable; the choice then lasts only for this page load.
  }
}

/** Desktop sidebar: hidden by default, peeks on hover, and stays open once pinned. */
export function useSidebarVisibility() {
  const [pinned, setPinnedState] = useState(readPinned);
  const [peeking, setPeeking] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const startPeek = useCallback(() => {
    cancelClose();
    setPeeking(true);
  }, [cancelClose]);

  const endPeek = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPeeking(false), PEEK_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const setPinned = useCallback((next: boolean) => {
    cancelClose();
    setPeeking(false);
    setPinnedState(next);
    writePinned(next);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  return { pinned, peeking, startPeek, endPeek, setPinned };
}
