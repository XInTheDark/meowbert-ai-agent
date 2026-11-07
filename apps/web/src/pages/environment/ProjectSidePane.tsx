import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "../../lib/types";
import { ProjectMapView } from "./map/ProjectMapView";
import { ProjectTaskPane } from "./ProjectTaskPane";

type SidePaneView = "tasks" | "map";
const STORAGE_KEY = "meowbert_project_side_pane_view";

function readView(): SidePaneView {
  try { return window.localStorage.getItem(STORAGE_KEY) === "map" ? "map" : "tasks"; } catch { return "tasks"; }
}

// The pane beside the Master conversation: the task list, or the project map.
export function ProjectSidePane(props: { workspaceId: string; project: Project; masterTaskId: string | null }) {
  const navigate = useNavigate();
  const [view, setView] = useState<SidePaneView>(readView);
  function select(next: SidePaneView) {
    setView(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Storage may be unavailable. */ }
  }
  return (
    <div className="project-side-pane">
      <div className="project-side-pane-tabs" role="tablist" aria-label="Project pane">
        {(["tasks", "map"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => select(item)}>
            {item === "tasks" ? "Tasks" : "Map"}
          </button>
        ))}
      </div>
      {view === "tasks" ? <ProjectTaskPane project={props.project} masterTaskId={props.masterTaskId} /> : (
        <aside className="project-task-pane project-map-pane" aria-label="Project map">
          <ProjectMapView workspaceId={props.workspaceId} projectId={props.project.id} masterTaskId={props.masterTaskId} variant="pane"
            onExpand={() => navigate(`/app/${props.workspaceId}/projects/${props.project.id}/map`)} />
        </aside>
      )}
    </div>
  );
}
