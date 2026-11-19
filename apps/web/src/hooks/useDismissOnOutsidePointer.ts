import { useEffect, type RefObject } from "react";

/**
 * Calls onDismiss when the user presses outside every given element or presses Escape, while active.
 * Elements portaled elsewhere in the page can be listed alongside their trigger.
 */
export function useDismissOnOutsidePointer(
  active: boolean,
  refs: Array<RefObject<HTMLElement | null>>,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && refs.some((ref) => ref.current?.contains(target))) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  // Ref objects are stable, so they are left out to avoid re-subscribing on every render.
  }, [active, onDismiss]);
}
