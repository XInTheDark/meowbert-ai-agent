import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExplorerRowActionButton } from "../../../components/explorer/ExplorerTable";

interface TaskActionsMenuProps {
  children: ReactNode;
  disabled?: boolean;
  open: boolean;
  title: string;
  onToggle: () => void;
}

interface MenuPosition {
  left: number;
  top: number;
}

type PositionedMenuStyle = CSSProperties & {
  "--task-actions-dropdown-left": string;
  "--task-actions-dropdown-top": string;
};

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;

export function TaskActionsMenu(props: TaskActionsMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!props.open) {
      setPosition(null);
      return;
    }

    function reposition(): void {
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchorRect || !menu) {
        return;
      }

      const maxLeft = window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(anchorRect.right - menu.offsetWidth, maxLeft));
      const belowTop = anchorRect.bottom + MENU_GAP;
      const aboveTop = anchorRect.top - MENU_GAP - menu.offsetHeight;
      const fitsBelow = belowTop + menu.offsetHeight <= window.innerHeight - VIEWPORT_MARGIN;
      const top = fitsBelow
        ? belowTop
        : Math.max(VIEWPORT_MARGIN, aboveTop);

      setPosition({ left, top });
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [props.open]);

  const menuStyle: PositionedMenuStyle | CSSProperties = position
    ? {
        "--task-actions-dropdown-left": `${position.left}px`,
        "--task-actions-dropdown-top": `${position.top}px`
      }
    : { visibility: "hidden" };

  return (
    <div className="task-actions-menu-trigger" ref={anchorRef} data-task-actions-menu>
      <ExplorerRowActionButton
        onClick={props.onToggle}
        disabled={props.disabled}
        title={props.title}
      />
      {props.open
        ? createPortal(
            <div
              className="task-actions-dropdown task-actions-dropdown-portal"
              ref={menuRef}
              role="menu"
              aria-label={props.title}
              style={menuStyle}
              data-task-actions-menu
            >
              {props.children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
