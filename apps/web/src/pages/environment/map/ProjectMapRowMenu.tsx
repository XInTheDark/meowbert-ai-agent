import { useCallback, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { MobileSheet } from "../../../components/mobile/MobileSheet";
import { useAnchoredMenuPosition } from "../../../hooks/useAnchoredMenuPosition";
import { useCompactViewport } from "../../../hooks/useCompactViewport";
import { useDismissOnOutsidePointer } from "../../../hooks/useDismissOnOutsidePointer";

export interface ProjectMapMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

type PositionedMenuStyle = CSSProperties & { "--project-map-menu-left": string; "--project-map-menu-top": string };

// The "more" menu on a map row: a dropdown on desktop and a bottom sheet on touch-first viewports,
// both outside the map's scroll area so neither is clipped.
export function ProjectMapRowMenu(props: { label: string; items: ProjectMapMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const compact = useCompactViewport();
  const close = useCallback(() => setOpen(false), []);
  const position = useAnchoredMenuPosition(open && !compact, root, menuRef);
  useDismissOnOutsidePointer(open && !compact, [root, menuRef], close);

  const menu = (style?: CSSProperties) => (
    <div ref={menuRef} className="project-map-menu" role="menu" aria-label={props.label} style={style}>
      {props.items.map((item) => (
        <button key={item.label} type="button" role="menuitem" className={item.danger ? "is-danger" : ""}
          onClick={() => { setOpen(false); item.onSelect(); }}>
          {item.label}
        </button>
      ))}
    </div>
  );
  const positionedStyle: PositionedMenuStyle | CSSProperties = position
    ? { "--project-map-menu-left": `${position.left}px`, "--project-map-menu-top": `${position.top}px` }
    : { visibility: "hidden" };

  // Clicks inside the menu, including its portaled list, must not reach the row underneath.
  return (
    <div className="project-map-row-menu" ref={root} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="icon-btn-subtle" aria-label={props.label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <MoreHorizontal size={15} />
      </button>
      {open && compact ? <MobileSheet label={props.label} onClose={close}>{menu()}</MobileSheet> : null}
      {open && !compact ? createPortal(menu(positionedStyle), document.body) : null}
    </div>
  );
}
