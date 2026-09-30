import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Link2,
  Search,
  Wrench,
  X
} from "lucide-react";
import type { TaskToolOptions } from "../../lib/types";
import {
  getWorkspaceSourceSetupLabel,
  isWorkspaceSourceReady,
  type WorkspaceSourceSummary
} from "../../sources/sourceTypes";
import {
  useChatToolsDropdownPlacement,
  type ChatToolsPopoverPlacement
} from "./useChatToolsDropdownPlacement";

interface SourceOptionsDropdownProps {
  toolOptions: TaskToolOptions;
  onChange?: (options: TaskToolOptions) => void;
  availableSources?: WorkspaceSourceSummary[];
  onSetupRequested?: (source: WorkspaceSourceSummary) => void;
  disabled?: boolean;
  variant?: "icon" | "button";
  label?: string;
  popoverPlacement?: ChatToolsPopoverPlacement;
}

function normalizeSourceMenuQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesSourceMenuQuery(query: string, ...values: Array<string | null | undefined>): boolean {
  const normalizedQuery = normalizeSourceMenuQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function filterSourceMenuSources(sources: WorkspaceSourceSummary[] | undefined, query: string): WorkspaceSourceSummary[] {
  if (!sources || sources.length === 0) {
    return [];
  }

  return [...sources]
    .filter((source) => matchesSourceMenuQuery(
      query,
      source.name,
      source.description,
      source.provider,
      source.connection.accountLabel,
      getWorkspaceSourceSetupLabel(source)
    ))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function SourceOptionsDropdown(props: SourceOptionsDropdownProps) {
  const {
    toolOptions,
    onChange,
    availableSources,
    onSetupRequested,
    disabled = false,
    variant = "icon",
    label = "Sources"
  } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const resolvedToolOptions: TaskToolOptions = {
    webSearch: toolOptions.webSearch === true,
    memorySearch: toolOptions.memorySearch === true,
    scheduleTask: toolOptions.scheduleTask === true,
    subtasks: toolOptions.subtasks === true,
    computerUse: toolOptions.computerUse === true,
    interactiveCanvas: toolOptions.interactiveCanvas === true,
    enabledSkills: toolOptions.enabledSkills ?? [],
    enabledSources: toolOptions.enabledSources ?? []
  };

  const filteredSources = useMemo(
    () => filterSourceMenuSources(availableSources, searchQuery),
    [availableSources, searchQuery]
  );
  const hasActiveSources = resolvedToolOptions.enabledSources.length > 0;

  useEffect(() => {
    if (!isOpen && searchQuery) {
      setSearchQuery("");
    }
  }, [isOpen, searchQuery]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function updateToolOptions(next: Partial<TaskToolOptions>): void {
    if (!onChange) {
      return;
    }

    onChange({
      ...resolvedToolOptions,
      ...next
    });
  }

  function toggleSource(source: WorkspaceSourceSummary): void {
    if (!isWorkspaceSourceReady(source)) {
      setIsOpen(false);
      onSetupRequested?.(source);
      return;
    }

    const current = resolvedToolOptions.enabledSources;
    const next = current.includes(source.id)
      ? current.filter((id) => id !== source.id)
      : [...current, source.id];
    updateToolOptions({ enabledSources: next });
  }

  const { popoverRef, popoverStyle, popoverClassName } = useChatToolsDropdownPlacement({
    triggerRef: menuRef,
    isOpen,
    placement: props.popoverPlacement,
    variant
  });

  return (
    <div ref={menuRef} className="chat-tools-menu">
      {variant === "icon" ? (
        <button
          type="button"
          className={`icon-btn-subtle ${hasActiveSources ? "active" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          title={label}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <Link2 size={18} />
        </button>
      ) : (
        <button
          type="button"
          className={`btn ghost ${hasActiveSources ? "active" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.6rem"
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", minWidth: 0 }}>
            <Link2 size={16} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {label}{hasActiveSources ? ` (${resolvedToolOptions.enabledSources.length} selected)` : ""}
            </span>
          </span>
          <ChevronDown size={16} />
        </button>
      )}

      {isOpen ? (
        <div
          ref={popoverRef}
          className={`chat-tools-popover ${popoverClassName}`}
          role="menu"
          aria-label={label}
          style={popoverStyle}
        >
          <div className="chat-tools-search" role="search">
            <Search size={14} />
            <input
              type="text"
              className="chat-tools-search-input"
              placeholder="Search sources"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search sources"
              autoFocus
            />
            {searchQuery ? (
              <button
                type="button"
                className="chat-tools-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear sources search"
              >
                <X size={13} />
              </button>
            ) : null}
          </div>

          <div className="chat-tools-popover-scroll">
            <div className="chat-tools-section-label">Sources</div>
            {filteredSources.map((source) => {
              const isReady = isWorkspaceSourceReady(source);
              const isEnabled = resolvedToolOptions.enabledSources.includes(source.id);

              return (
                <button
                  key={source.id}
                  type="button"
                  className={`chat-tools-item ${isEnabled ? "active" : ""}`}
                  onClick={() => toggleSource(source)}
                  role={isReady ? "menuitemcheckbox" : "menuitem"}
                  aria-checked={isReady ? isEnabled : undefined}
                  title={source.description}
                  style={{ alignItems: "flex-start" }}
                >
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.2rem", minWidth: 0 }}>
                    <span className="chat-tools-item-label">
                      <Link2 size={14} />
                      {source.name}
                    </span>
                    <span className="muted-text" style={{ fontSize: "0.76rem", textAlign: "left", paddingLeft: "1.2rem" }}>
                      {getWorkspaceSourceSetupLabel(source)}
                    </span>
                  </span>
                  {isReady ? (
                    isEnabled ? <Check size={14} /> : null
                  ) : (
                    <span className="muted-text" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.76rem" }}>
                      <Wrench size={12} />
                      Set up
                    </span>
                  )}
                </button>
              );
            })}

            {filteredSources.length === 0 ? (
              <div className="chat-tools-empty">
                {searchQuery.trim().length > 0
                  ? `No sources match "${searchQuery.trim()}".`
                  : "No sources available yet."}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
