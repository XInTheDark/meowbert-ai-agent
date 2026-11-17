import { useEffect } from "react";

const KEYBOARD_MIN_INSET_PX = 120;
/** How long to keep re-reading the viewport after a change, to catch the end of the keyboard animation. */
const SETTLE_WINDOW_MS = 1000;

/**
 * Mirrors the visual viewport into CSS variables so the mobile shell can follow the on-screen keyboard.
 * iOS pans the page instead of resizing it when the keyboard opens, which otherwise leaves the composer
 * hidden or the shell scrolled away from the top.
 *
 * iOS does not reliably fire a final visualViewport event once the keyboard finishes animating, so the
 * last reading can be a mid-animation height. After every viewport, window, or focus change we keep
 * re-reading on each frame for a short window so the shell always lands on the settled size.
 */
export function useVisualViewportMetrics(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const root = document.documentElement;
    let lastSignature = "";
    let settleFrame = 0;
    let settleUntil = 0;

    const apply = () => {
      const keyboardInset = window.innerHeight - viewport.height - viewport.offsetTop;
      const isKeyboardOpen = keyboardInset > KEYBOARD_MIN_INSET_PX;
      const signature = isKeyboardOpen ? `${viewport.height}:${viewport.offsetTop}` : "closed";
      if (!isKeyboardOpen && window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;

      if (isKeyboardOpen) {
        root.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
        root.style.setProperty("--visual-viewport-top", `${viewport.offsetTop}px`);
        root.dataset.keyboardOpen = "true";
        return;
      }

      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--visual-viewport-top");
      delete root.dataset.keyboardOpen;
    };

    const settle = () => {
      apply();
      if (performance.now() < settleUntil) {
        settleFrame = requestAnimationFrame(settle);
      } else {
        settleFrame = 0;
      }
    };

    const update = () => {
      settleUntil = performance.now() + SETTLE_WINDOW_MS;
      if (!settleFrame) {
        settle();
      }
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    document.addEventListener("input", update);
    return () => {
      cancelAnimationFrame(settleFrame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.removeEventListener("input", update);
      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--visual-viewport-top");
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
