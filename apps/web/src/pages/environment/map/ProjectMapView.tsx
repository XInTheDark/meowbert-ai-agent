import { useMemo, useState } from "react";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { sendToMasterComposer } from "../../../task/masterComposerAttachments";
import { buildTaskRoutePath } from "../../../task/taskRouteContext";
import { ProjectMapBoard } from "./ProjectMapBoard";
import { ProjectMapBrief } from "./ProjectMapBrief";
import { ProjectMapDialogs, type ProjectMapDialog } from "./ProjectMapDialogs";
import { ProjectMapToolbar, type ProjectMapLayout } from "./ProjectMapToolbar";
import { ProjectMapTree } from "./ProjectMapTree";
import { buildProjectMapModel } from "./projectMapModel";
import { buildProjectMapAttachment } from "./projectMapSelection";
import type { ProjectMapViewContext } from "./projectMapViewContext";
import { useProjectMap } from "./useProjectMap";
import { useProjectMapActions } from "./useProjectMapActions";
import { useProjectMapDrag } from "./useProjectMapDrag";
import { useProjectMapSelection } from "./useProjectMapSelection";
import "./projectMap.css";

function useStoredLayout(key: string, fallback: ProjectMapLayout) {
  const storageKey = `meowbert_project_map_layout:${key}`;
  const [layout, setLayout] = useState<ProjectMapLayout>(() => {
    try { return (window.localStorage.getItem(storageKey) as ProjectMapLayout | null) ?? fallback; } catch { return fallback; }
  });
  function change(next: ProjectMapLayout) {
    setLayout(next);
    try { window.localStorage.setItem(storageKey, next); } catch { /* Storage may be unavailable. */ }
  }
  return [layout, change] as const;
}

export interface ProjectMapViewProps {
  workspaceId: string;
  projectId: string;
  masterTaskId: string | null;
  variant: "pane" | "page";
  onExpand?: () => void;
  // Called after a selection is sent to the Master, so a full page can take the user there.
  onAttached?: () => void;
}

export function ProjectMapView(props: ProjectMapViewProps) {
  return <ProjectMapSession key={`${props.workspaceId}:${props.projectId}`} {...props} />;
}

function ProjectMapSession(props: ProjectMapViewProps) {
  const controller = useProjectMap(props.projectId);
  const actions = useProjectMapActions(controller);
  const selection = useProjectMapSelection();
  const drag = useProjectMapDrag({ selected: selection.selected, onMove: actions.move });
  const [layout, setLayout] = useStoredLayout(props.variant, props.variant === "page" ? "board" : "tree");
  const [boardRoot, setBoardRoot] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ProjectMapDialog | null>(null);
  const model = useMemo(() => controller.map ? buildProjectMapModel(controller.map) : null, [controller.map]);
  const openDialog = (next: ProjectMapDialog | null) => {
    controller.clearMutationError();
    setDialog(next);
  };

  if (!model) {
    return controller.error ? <div className="error-banner">{controller.error}</div> : <LoadingIndicator center size={22} label="Loading map…" />;
  }
  const ctx: ProjectMapViewContext = {
    model, selection, drag, openDialog,
    deleteFolder: actions.deleteFolder, deleteCard: actions.deleteCard,
    taskHref: (taskId) => buildTaskRoutePath({ workspaceId: props.workspaceId, projectId: props.projectId, taskId })
  };
  const root = boardRoot && model.folder(boardRoot) ? boardRoot : null;
  const attach = props.masterTaskId ? () => {
    const attachment = buildProjectMapAttachment(model.map, selection.selected);
    if (!attachment || !props.masterTaskId) return;
    sendToMasterComposer(props.masterTaskId, [attachment]);
    selection.clear();
    props.onAttached?.();
  } : null;

  return (
    <div className={`project-map is-${props.variant}`}>
      <ProjectMapToolbar layout={layout} onLayoutChange={setLayout}
        onNewFolder={() => openDialog({ kind: "new-folder", parentFolderId: layout === "board" ? root : null })}
        onNewCard={() => openDialog({ kind: "new-card", folderId: layout === "board" ? root : null })}
        selectedCount={selection.selected.length} onAttach={attach} onClearSelection={selection.clear} onExpand={props.onExpand} />
      {controller.error ? <div className="error-banner" role="status">{controller.error}</div> : null}
      <div className="project-map-scroll">
        <ProjectMapBrief markdown={model.map.brief} onEdit={() => openDialog({ kind: "brief", markdown: model.map.brief })} />
        {layout === "tree" ? <ProjectMapTree ctx={ctx} /> : <ProjectMapBoard ctx={ctx} rootId={root} onOpen={setBoardRoot} />}
        {model.map.tasksTruncated ? <p className="project-map-empty-hint">Only the most recently updated tasks are shown.</p> : null}
      </div>
      <ProjectMapDialogs dialog={dialog} error={controller.mutationError} onClose={() => openDialog(null)} actions={actions.dialogActions} />
    </div>
  );
}
