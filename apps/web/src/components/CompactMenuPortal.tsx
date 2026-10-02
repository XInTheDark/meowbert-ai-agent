import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCompactViewport } from "../hooks/useCompactViewport";

export function CompactMenuPortal(props: { children: ReactNode }) {
  const compact = useCompactViewport();
  return compact ? createPortal(props.children, document.body) : props.children;
}
