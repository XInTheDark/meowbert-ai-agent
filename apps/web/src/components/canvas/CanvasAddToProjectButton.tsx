import { useCallback, useState } from "react";
import { FolderInput, FolderKanban } from "lucide-react";
import type { ProjectCanvasSummary } from "../../lib/types";
import { SearchablePopover } from "../menus/SearchablePopover";

interface ProjectOption {
  id: string;
  name: string;
}

/** Copies a task's canvas page into a project canvas, so other tasks in that project can open and change it. */
export function CanvasAddToProjectButton(props: {
  projects: ProjectOption[];
  currentProjectId: string | null;
  onAdd: (projectId: string) => Promise<ProjectCanvasSummary>;
  onOpenCanvas: (canvas: ProjectCanvasSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<{ canvas: ProjectCanvasSummary; projectName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => { setOpen(false); setAdded(null); setError(null); }, []);
  const ordered = [...props.projects].sort((a, b) =>
    Number(b.id === props.currentProjectId) - Number(a.id === props.currentProjectId) || a.name.localeCompare(b.name));

  async function add(projectId: string, projectName: string) {
    setBusyId(projectId);
    setError(null);
    try {
      setAdded({ canvas: await props.onAdd(projectId), projectName });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the canvas.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="topbar-dropdown">
      <button type="button" className={`icon-btn${open ? " active" : ""}`} onClick={() => (open ? close() : setOpen(true))}
        title="Add to project" aria-label="Add to project" aria-expanded={open}>
        <FolderInput size={14} aria-hidden="true" />
      </button>
      {open ? (
        <SearchablePopover
          label="Add to project"
          placeholder="Search projects"
          emptyLabel="No matching projects"
          onClose={close}
          busyId={busyId}
          items={ordered.map((project) => ({
            id: project.id,
            label: project.name,
            detail: project.id === props.currentProjectId ? "This project" : null,
            icon: <FolderKanban size={15} />
          }))}
          onPick={(item) => void add(item.id, item.label)}
          footer={added ? (
            <div className="searchable-popover-result">
              <span>Added to {added.projectName}</span>
              <button type="button" className="btn ghost" onClick={() => { props.onOpenCanvas(added.canvas); close(); }}>Open</button>
            </div>
          ) : error ? <span className="searchable-popover-error">{error}</span>
            : <span className="muted-text">Copies this page and its folder into the project's canvases.</span>}
        />
      ) : null}
    </div>
  );
}
