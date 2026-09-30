import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandPaletteAction {
  id: string;
  title: string;
  subtitle?: string;
  section?: string;
  keywords?: string[];
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  actions: CommandPaletteAction[];
  onClose: () => void;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function matchesQuery(query: string, action: CommandPaletteAction): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    action.title,
    action.subtitle ?? "",
    action.section ?? "",
    ...(action.keywords ?? [])
  ].join(" ").toLowerCase();

  return haystack.includes(normalizedQuery);
}

export function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredActions = useMemo(() => actions.filter((action) => matchesQuery(query, action)), [actions, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }

    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextIndex = filteredActions.length === 0 ? 0 : Math.min(activeIndex, filteredActions.length - 1);
    if (nextIndex !== activeIndex) {
      setActiveIndex(nextIndex);
    }
  }, [activeIndex, filteredActions.length, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => {
          if (filteredActions.length === 0) {
            return 0;
          }
          return (current + 1) % filteredActions.length;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => {
          if (filteredActions.length === 0) {
            return 0;
          }
          return current === 0 ? filteredActions.length - 1 : current - 1;
        });
        return;
      }

      if (event.key === "Enter") {
        const action = filteredActions[activeIndex];
        if (!action) {
          return;
        }
        event.preventDefault();
        action.onSelect();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, filteredActions, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette-card" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          placeholder="Search commands"
        />
        <div className="command-palette-list">
          {filteredActions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={`command-palette-item ${index === activeIndex ? "active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                action.onSelect();
                onClose();
              }}
            >
              <span>
                <strong>{action.title}</strong>
                {action.subtitle ? <span className="muted-text" style={{ display: "block", marginTop: "0.12rem" }}>{action.subtitle}</span> : null}
              </span>
              {action.section ? <span className="muted-text" style={{ fontSize: "0.78rem" }}>{action.section}</span> : null}
            </button>
          ))}
          {filteredActions.length === 0 ? (
            <div className="command-palette-empty">No commands match “{query.trim()}”.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
