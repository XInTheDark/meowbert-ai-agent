import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface SidebarMenuProps {
  /** Accessible name for the trigger. */
  label: string;
  /** Trigger contents. Rendered inside the trigger button. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Menu contents. Receives a `close` callback for items that navigate. */
  children: (close: () => void) => ReactNode;
  /** Shows an unread indicator on the trigger. */
  hasUnread?: boolean;
  align?: "start" | "end";
}

/**
 * A popover anchored to a sidebar control.
 *
 * The sidebar sets `overflow-y: auto` and `overflow-x: hidden`, which would clip an
 * absolutely-positioned menu, so this portals to the body and positions itself from
 * the trigger's rect.
 */
export function SidebarMenu({
  label,
  trigger,
  triggerClassName,
  children,
  hasUnread,
  align = "start"
}: SidebarMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; bottom: number } | null>(null);

  const close = (): void => {
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function reposition(): void {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const menuWidth = menuRef.current?.offsetWidth ?? 240;
      const rawLeft = align === "end" ? rect.right - menuWidth : rect.left;
      const maxLeft = window.innerWidth - menuWidth - 8;
      setStyle({
        left: Math.max(8, Math.min(rawLeft, maxLeft)),
        bottom: Math.max(8, window.innerHeight - rect.top + 6)
      });
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      // The theme picker portals its own popover outside this menu; clicking a
      // theme in it must not dismiss the menu that opened it.
      if (target.closest?.(".theme-popover")) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`sidebar-menu-trigger${triggerClassName ? ` ${triggerClassName}` : ""}${open ? " open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        {trigger}
        {hasUnread ? <span className="sidebar-menu-dot" aria-hidden="true" /> : null}
      </button>
      {open
        ? createPortal(
            <div
              className="sidebar-menu-panel"
              ref={menuRef}
              role="menu"
              aria-label={label}
              style={style ? { left: style.left, bottom: style.bottom } : { visibility: "hidden" }}
            >
              {children(close)}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
