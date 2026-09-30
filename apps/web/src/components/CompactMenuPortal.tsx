import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const compactMenuQuery = "(max-width: 1120px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia?.(compactMenuQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

function isCompact(): boolean {
  return window.matchMedia?.(compactMenuQuery).matches ?? false;
}

export function CompactMenuPortal(props: { children: ReactNode }) {
  const compact = useSyncExternalStore(subscribe, isCompact, () => false);
  return compact ? createPortal(props.children, document.body) : props.children;
}
