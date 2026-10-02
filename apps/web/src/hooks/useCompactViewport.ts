import { useSyncExternalStore } from "react";

// Matches the CSS breakpoint where the app switches to its touch-first layout (bottom sheets, mobile nav).
const compactViewportQuery = "(max-width: 1120px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.(compactViewportQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

function isCompactViewport(): boolean {
  return window.matchMedia?.(compactViewportQuery).matches ?? false;
}

export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, isCompactViewport, () => false);
}
