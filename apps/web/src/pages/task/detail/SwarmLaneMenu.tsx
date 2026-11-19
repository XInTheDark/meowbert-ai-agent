import { useCallback, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MobileSheet } from "../../../components/mobile/MobileSheet";
import { useAnchoredMenuPosition } from "../../../hooks/useAnchoredMenuPosition";
import { useCompactViewport } from "../../../hooks/useCompactViewport";
import { useDismissOnOutsidePointer } from "../../../hooks/useDismissOnOutsidePointer";

export interface SwarmLaneMenuItem {
  id: string;
  title: string;
  detail: string;
}

interface SwarmLaneMenuProps {
  label: string;
  title: string;
  items: SwarmLaneMenuItem[];
  onOpenLane: (laneId: string) => void;
}

type PositionedListStyle = CSSProperties & { "--swarm-lane-menu-left": string; "--swarm-lane-menu-top": string };

// A header chip with a lane count that lists those lanes: a dropdown on desktop, a bottom sheet on
// touch-first viewports. Both render outside the header so nothing clips them.
export function SwarmLaneMenu(props: SwarmLaneMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const compact = useCompactViewport();
  const close = useCallback(() => setIsOpen(false), []);
  const position = useAnchoredMenuPosition(isOpen && !compact, anchorRef, listRef);
  useDismissOnOutsidePointer(isOpen && !compact, [anchorRef, listRef], close);

  if (props.items.length === 0) {
    return <span className="task-workflow-strip-chip"><span>{props.label}</span><strong>0</strong></span>;
  }

  const list = (style?: CSSProperties) => (
    <ul ref={listRef} className="swarm-lane-menu-list" role="menu" aria-label={props.title} style={style}>
      {props.items.map((item) => (
        <li key={item.id}>
          <button type="button" role="menuitem" onClick={() => {
            setIsOpen(false);
            props.onOpenLane(item.id);
          }}>
            <strong>{item.title}</strong>
            {item.detail ? <span>{item.detail}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
  const positionedStyle: PositionedListStyle | CSSProperties = position
    ? { "--swarm-lane-menu-left": `${position.left}px`, "--swarm-lane-menu-top": `${position.top}px` }
    : { visibility: "hidden" };

  return (
    <span ref={anchorRef} className="swarm-lane-menu">
      <button type="button" className="task-workflow-strip-chip" aria-expanded={isOpen} aria-haspopup="menu"
        onClick={() => setIsOpen((current) => !current)} title={props.title}>
        <span>{props.label}</span><strong>{props.items.length}</strong>
      </button>
      {isOpen && compact ? <MobileSheet label={props.title} onClose={close}>{list()}</MobileSheet> : null}
      {isOpen && !compact ? createPortal(list(positionedStyle), document.body) : null}
    </span>
  );
}
