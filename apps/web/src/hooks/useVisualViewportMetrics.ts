import { useEffect } from "react";

const KEYBOARD_MIN_INSET_PX = 120;

/**
 * Mirrors the visual viewport into CSS variables so the mobile shell can follow the on-screen keyboard.
 * iOS pans the page instead of resizing it when the keyboard opens, which otherwise leaves the composer
 * hidden or the shell scrolled away from the top.
 */
export function useVisualViewportMetrics(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const root = document.documentElement;
    const update = () => {
      const keyboardInset = window.innerHeight - viewport.height - viewport.offsetTop;
      const isKeyboardOpen = keyboardInset > KEYBOARD_MIN_INSET_PX;
      if (isKeyboardOpen) {
        root.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
        root.style.setProperty("--visual-viewport-top", `${viewport.offsetTop}px`);
        root.dataset.keyboardOpen = "true";
        return;
      }

      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--visual-viewport-top");
      delete root.dataset.keyboardOpen;
      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--visual-viewport-top");
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
