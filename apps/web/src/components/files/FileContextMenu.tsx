import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCompactViewport } from "../../hooks/useCompactViewport";
import { MobileSheet } from "../mobile/MobileSheet";

export function FileContextMenu(props: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const compact = useCompactViewport();

  useLayoutEffect(() => {
    const reposition = () => {
      const menu = menuRef.current;
      if (!menu) {
        return;
      }
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(props.x, window.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(props.y, window.innerHeight - bounds.height - 8))}px`;
    };
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [props.x, props.y, props.children, compact]);

  if (compact) {
    return (
      <MobileSheet label="File actions" onClose={props.onClose}>
        <div className="context-menu file-context-menu">{props.children}</div>
      </MobileSheet>
    );
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu file-context-menu"
      onClick={(event) => event.stopPropagation()}
    >
      {props.children}
    </div>,
    document.body
  );
}
