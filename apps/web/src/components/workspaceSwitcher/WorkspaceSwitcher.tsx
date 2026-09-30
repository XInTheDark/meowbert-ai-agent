import { ChevronDown, Check, Plus, Search, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "../../lib/types";
import { WorkspaceIcon } from "../workspaceIcon/WorkspaceIcon";
import { filterWorkspaces, sortWorkspaceOptions } from "./workspaceSearch";

interface WorkspaceSwitcherProps {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onManageWorkspaces: () => void;
}

export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const activeWorkspace = props.workspaces.find((workspace) => workspace.id === props.activeWorkspaceId);
  const orderedWorkspaces = useMemo(
    () => sortWorkspaceOptions(props.workspaces, props.activeWorkspaceId),
    [props.activeWorkspaceId, props.workspaces]
  );
  const visibleWorkspaces = useMemo(
    () => filterWorkspaces(orderedWorkspaces, query),
    [orderedWorkspaces, query]
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function closeAfter(action: () => void): void {
    action();
    setOpen(false);
  }

  return (
    <div className="workspace-switcher" data-onboarding-id="workspace-switcher" ref={rootRef}>
      <button
        type="button"
        className="workspace-switcher-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="workspace-switcher-mark" aria-hidden="true">
          <WorkspaceIcon iconKey={activeWorkspace?.iconKey} size={16} />
        </span>
        <span className="workspace-switcher-copy">
          <strong>{activeWorkspace?.name ?? "Workspace"}</strong>
          <span>{activeWorkspace?.role ?? "member"}</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open ? (
        <div className="workspace-switcher-popover" role="dialog" aria-label="Switch workspace">
          <label className="workspace-switcher-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workspaces"
            />
          </label>

          <div className="workspace-switcher-list">
            {visibleWorkspaces.map((workspace) => {
              const selected = workspace.id === props.activeWorkspaceId;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className={`workspace-switcher-option${selected ? " selected" : ""}`}
                  onClick={() => closeAfter(() => props.onSelectWorkspace(workspace.id))}
                >
                  <span className="workspace-switcher-option-mark" aria-hidden="true">
                    <WorkspaceIcon iconKey={workspace.iconKey} size={15} />
                  </span>
                  <span>
                    <strong>{workspace.name}</strong>
                    <span>{workspace.role}</span>
                  </span>
                  {selected ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              );
            })}

            {visibleWorkspaces.length === 0 ? (
              <div className="workspace-switcher-empty">No matching workspaces.</div>
            ) : null}
          </div>

          <div className="workspace-switcher-actions">
            <button type="button" onClick={() => closeAfter(props.onCreateWorkspace)} title="New workspace">
              <Plus size={15} />
              <span>New</span>
            </button>
            <button type="button" onClick={() => closeAfter(props.onManageWorkspaces)} title="Manage workspaces">
              <Settings size={15} />
              <span>Manage</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
