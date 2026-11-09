import { useCallback, useState } from "react";
import { AppWindow, LayoutTemplate } from "lucide-react";
import { getCanvasViewKey, getCanvasViewTitle, type CanvasView } from "../../../components/canvas/canvasViews";
import { SearchablePopover } from "../../../components/menus/SearchablePopover";

/** Top bar list of every canvas in the task, so one opens in the panel without scrolling to its card. */
export function TaskCanvasesMenu(props: {
  views: CanvasView[];
  activeKey: string | null;
  onOpen: (view: CanvasView) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (props.views.length === 0) return null;
  const byKey = new Map(props.views.map((view) => [getCanvasViewKey(view), view]));

  return (
    <div className="topbar-dropdown task-canvases-menu">
      <button type="button" className={`task-topbar-icon-btn task-canvases-trigger${open ? " active" : ""}`}
        onClick={() => setOpen((current) => !current)} title="Canvases" aria-label="Canvases" aria-expanded={open}>
        <LayoutTemplate size={16} aria-hidden="true" />
        <span className="task-canvases-count">{props.views.length}</span>
      </button>
      {open ? (
        <SearchablePopover
          label="Canvases"
          placeholder="Search canvases"
          emptyLabel="No matching canvases"
          onClose={close}
          items={props.views.map((view) => ({
            id: getCanvasViewKey(view),
            label: getCanvasViewTitle(view),
            detail: view.canvasId ? "Project canvas" : view.relativePath,
            icon: <AppWindow size={15} />,
            active: getCanvasViewKey(view) === props.activeKey
          }))}
          onPick={(item) => {
            const view = byKey.get(item.id);
            if (view) props.onOpen(view);
            close();
          }}
        />
      ) : null}
    </div>
  );
}
