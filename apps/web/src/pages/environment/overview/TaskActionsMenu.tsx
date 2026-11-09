import { useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExplorerRowActionButton } from "../../../components/explorer/ExplorerTable";
import { MobileSheet } from "../../../components/mobile/MobileSheet";
import { useAnchoredMenuPosition } from "../../../hooks/useAnchoredMenuPosition";
import { useCompactViewport } from "../../../hooks/useCompactViewport";

interface TaskActionsMenuProps {
  children: ReactNode;
  disabled?: boolean;
  open: boolean;
  title: string;
  onToggle: () => void;
}

type PositionedMenuStyle = CSSProperties & {
  "--task-actions-dropdown-left": string;
  "--task-actions-dropdown-top": string;
};

export function TaskActionsMenu(props: TaskActionsMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const compact = useCompactViewport();
  const position = useAnchoredMenuPosition(props.open && !compact, anchorRef, menuRef);

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
      {props.open && compact ? (
        <MobileSheet label={props.title} onClose={props.onToggle}>
          <div className="task-actions-dropdown" role="menu" aria-label={props.title} data-task-actions-menu>
            {props.children}
          </div>
        </MobileSheet>
      ) : null}
      {props.open && !compact
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
