import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Search } from "lucide-react";

export interface SearchablePopoverItem {
  id: string;
  label: string;
  detail?: string | null;
  icon?: ReactNode;
  active?: boolean;
}

/** A dropdown list anchored to its trigger, with a filter field once the list is long enough to need one. */
export function SearchablePopover(props: {
  items: SearchablePopoverItem[];
  label: string;
  placeholder: string;
  emptyLabel: string;
  onPick: (item: SearchablePopoverItem) => void;
  onClose: () => void;
  align?: "start" | "end";
  busyId?: string | null;
  footer?: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchable = props.items.length > 5;
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return props.items;
    return props.items.filter((item) => `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(needle));
  }, [filter, props.items]);
  const { onClose } = props;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      const parent = rootRef.current?.parentElement;
      if (parent && !parent.contains(event.target as Node)) onClose();
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={rootRef} className={`searchable-popover align-${props.align ?? "end"}`} role="dialog" aria-label={props.label}>
      {searchable ? (
        <label className="searchable-popover-search">
          <Search size={14} aria-hidden="true" />
          <input
            autoFocus
            value={filter}
            placeholder={props.placeholder}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && visible[0]) props.onPick(visible[0]);
            }}
          />
        </label>
      ) : null}
      <ul className="searchable-popover-list" role="listbox">
        {visible.map((item) => (
          <li key={item.id}>
            <button type="button" role="option" aria-selected={item.active === true} className={item.active ? "active" : ""}
              disabled={props.busyId !== undefined && props.busyId !== null} onClick={() => props.onPick(item)}>
              {item.icon ? <span className="searchable-popover-icon">{item.icon}</span> : null}
              <span className="searchable-popover-text">
                <span className="searchable-popover-label">{item.label}</span>
                {item.detail ? <span className="searchable-popover-detail">{item.detail}</span> : null}
              </span>
              {props.busyId === item.id ? <Loader2 size={14} className="spin" aria-label="Working" />
                : item.active ? <Check size={14} aria-hidden="true" className="searchable-popover-check" /> : null}
            </button>
          </li>
        ))}
        {visible.length === 0 ? <li className="searchable-popover-empty">{props.emptyLabel}</li> : null}
      </ul>
      {props.footer ? <div className="searchable-popover-footer">{props.footer}</div> : null}
    </div>
  );
}
