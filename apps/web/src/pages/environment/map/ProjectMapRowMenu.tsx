import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export interface ProjectMapMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

// The "more" menu on a map row.
export function ProjectMapRowMenu(props: { label: string; items: ProjectMapMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="project-map-row-menu" ref={root}>
      <button type="button" className="icon-btn-subtle" aria-label={props.label} aria-haspopup="menu" aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>
        <MoreHorizontal size={15} />
      </button>
      {open ? (
        <div className="project-map-menu" role="menu">
          {props.items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? "is-danger" : ""}
              onClick={(event) => { event.stopPropagation(); setOpen(false); item.onSelect(); }}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
