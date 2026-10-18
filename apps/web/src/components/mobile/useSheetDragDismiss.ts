import { useEffect, type RefObject } from "react";

const DISMISS_DISTANCE_PX = 96;
const DISMISS_VELOCITY_PX_PER_MS = 0.6;

/**
 * Lets the user drag a sheet down by its handle to dismiss it, the way native bottom sheets behave.
 * The panel follows the finger; releasing past the distance or with a fast flick closes it.
 */
export function useSheetDragDismiss(
  handleRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  onDismiss: () => void
): void {
  useEffect(() => {
    const handle = handleRef.current;
    const panel = panelRef.current;
    if (!handle || !panel) {
      return;
    }

    let startY = 0;
    let startTime = 0;
    let offset = 0;
    let pointerId: number | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      pointerId = event.pointerId;
      startY = event.clientY;
      startTime = event.timeStamp;
      offset = 0;
      handle.setPointerCapture(event.pointerId);
      panel.style.transition = "none";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        return;
      }
      offset = Math.max(0, event.clientY - startY);
      panel.style.transform = `translateY(${offset}px)`;
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        return;
      }
      pointerId = null;
      const elapsed = Math.max(1, event.timeStamp - startTime);
      const shouldDismiss = offset > DISMISS_DISTANCE_PX || offset / elapsed > DISMISS_VELOCITY_PX_PER_MS;
      panel.style.transition = "";
      panel.style.transform = "";
      if (shouldDismiss) {
        onDismiss();
      }
    };

    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerEnd);
    handle.addEventListener("pointercancel", onPointerEnd);
    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerEnd);
      handle.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [handleRef, panelRef, onDismiss]);
}
