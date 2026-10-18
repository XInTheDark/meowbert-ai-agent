import type { ReactNode } from "react";
import { useCompactViewport } from "../../hooks/useCompactViewport";
import { MobileSheet } from "./MobileSheet";

/** Shows a dropdown in place on desktop and as a bottom sheet on touch-first viewports. */
export function MenuSheet(props: { label: string; onClose: () => void; children: ReactNode }) {
  const compact = useCompactViewport();
  if (!compact) {
    return <>{props.children}</>;
  }
  return <MobileSheet label={props.label} onClose={props.onClose}>{props.children}</MobileSheet>;
}
