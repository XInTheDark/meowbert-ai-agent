import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getMobileSheetLayer } from "./mobileSheetLayer";
import { useSheetDragDismiss } from "./useSheetDragDismiss";

/**
 * A native-style bottom sheet: dimmed backdrop, drag handle, safe-area padding and its own scroll area.
 * It portals to a body-level layer so no transformed or clipped ancestor can trap it.
 */
export function MobileSheet(props: { label: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const close = useCallback(() => onCloseRef.current(), []);
  useSheetDragDismiss(handleRef, panelRef, close);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return createPortal(
    <div className="mobile-sheet-root">
      <div className="mobile-sheet-backdrop" aria-hidden="true" onClick={close} />
      <div ref={panelRef} className="mobile-sheet" role="dialog" aria-modal="true" aria-label={props.label}>
        <div ref={handleRef} className="mobile-sheet-handle" aria-hidden="true">
          <span />
        </div>
        <div className="mobile-sheet-content">{props.children}</div>
      </div>
    </div>,
    getMobileSheetLayer()
  );
}
