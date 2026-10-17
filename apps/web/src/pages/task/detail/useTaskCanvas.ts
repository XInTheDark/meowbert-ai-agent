import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasHost } from "../../../components/canvas/CanvasHostContext";
import { getCanvasViewKey, type CanvasView } from "../../../components/canvas/canvasViews";
import { useProjectCanvasTickets } from "../../../components/canvas/useProjectCanvasTickets";
import { buildProjectCanvasPreviewUrl } from "../../../lib/projectCanvases";
import { buildTaskInlineFileUrl } from "../../../lib/taskInlineFiles";
import type { LiveEvent, ProjectCanvasSummary } from "../../../lib/types";

interface CanvasUpdate {
  relativePath: string;
  canvasId: string | null;
  display: "inline" | "panel";
}

function readCanvasUpdate(event: LiveEvent): CanvasUpdate | null {
  const update = event.type === "artifact" ? event.payload.canvasUpdate : null;
  if (!update || typeof update !== "object") return null;
  const candidate = update as Record<string, unknown>;
  if (typeof candidate.relativePath !== "string") return null;
  return {
    relativePath: candidate.relativePath,
    canvasId: typeof candidate.canvasId === "string" ? candidate.canvasId : null,
    display: candidate.display === "panel" ? "panel" : "inline"
  };
}

export function projectCanvasView(canvas: ProjectCanvasSummary): CanvasView {
  return { type: "html", relativePath: canvas.entryPath, canvasId: canvas.id, title: canvas.name, display: "panel", height: null };
}

function useCanvasPanelState(projectCanvases: ProjectCanvasSummary[]) {
  const [openedViews, setOpenedViews] = useState<CanvasView[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const views = useMemo(() => {
    const byKey = new Map<string, CanvasView>();
    for (const view of [...projectCanvases.map(projectCanvasView), ...openedViews]) byKey.set(getCanvasViewKey(view), view);
    return [...byKey.values()];
  }, [openedViews, projectCanvases]);
  const open = useCallback((view: CanvasView) => {
    const key = getCanvasViewKey(view);
    setOpenedViews((current) => current.some((item) => getCanvasViewKey(item) === key) ? current : [...current, view]);
    setActiveKey(key);
  }, []);
  const close = useCallback(() => setActiveKey(null), []);
  const activeView = activeKey ? views.find((view) => getCanvasViewKey(view) === activeKey) ?? null : null;
  return { views, activeView, open, close };
}

// Each show_canvas call reloads views of that page; one shown in the panel display also opens it.
function useCanvasUpdates(events: LiveEvent[], onPanelUpdate: (update: CanvasUpdate) => void) {
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const seenEventIds = useRef(new Set<string>());
  // History loads after mount; only updates from about now on act on views (with slack for clock skew).
  const mountedAt = useRef(Date.now() - 10_000);
  const onPanelUpdateRef = useRef(onPanelUpdate);
  onPanelUpdateRef.current = onPanelUpdate;

  useEffect(() => {
    for (const event of events) {
      if (seenEventIds.current.has(event.id)) continue;
      seenEventIds.current.add(event.id);
      if (Date.parse(event.createdAt) < mountedAt.current) continue;
      const update = readCanvasUpdate(event);
      if (!update) continue;
      setRevisions((current) => {
        const key = getCanvasViewKey(update);
        return { ...current, [key]: (current[key] ?? 0) + 1 };
      });
      if (update.display === "panel") onPanelUpdateRef.current(update);
    }
  }, [events]);

  return revisions;
}

/** The task page's canvas host: sources, live reloads and the panel beside the conversation. */
export function useTaskCanvas(input: {
  taskId: string | null;
  projectId: string | null;
  token: string | null;
  inlineFileTicket: string | null;
  projectCanvases: ProjectCanvasSummary[];
  events: LiveEvent[];
  requestedCanvasId: string | null;
  sendPrompt: (prompt: string) => void;
}) {
  const panel = useCanvasPanelState(input.projectCanvases);
  const getProjectCanvasTicket = useProjectCanvasTickets(input.projectId, input.token);
  const revisions = useCanvasUpdates(input.events, (update) => panel.open({
    type: "html", relativePath: update.relativePath, canvasId: update.canvasId, title: null, display: "panel", height: null
  }));

  useEffect(() => {
    const canvas = input.projectCanvases.find((item) => item.id === input.requestedCanvasId);
    if (canvas) panel.open(projectCanvasView(canvas));
  }, [input.projectCanvases, input.requestedCanvasId, panel.open]);

  const { taskId, projectId, inlineFileTicket, sendPrompt } = input;
  const host = useMemo<CanvasHost>(() => ({
    taskId,
    resolveSource: (view) => {
      if (view.canvasId) {
        const ticket = getProjectCanvasTicket(view.canvasId);
        return ticket && projectId
          ? { src: buildProjectCanvasPreviewUrl(projectId, view.canvasId, ticket, view.relativePath), srcKey: getCanvasViewKey(view) }
          : null;
      }
      return inlineFileTicket && taskId
        ? { src: buildTaskInlineFileUrl(taskId, inlineFileTicket, view.relativePath), srcKey: getCanvasViewKey(view) }
        : null;
    },
    reloadTokenFor: (view) => revisions[getCanvasViewKey(view)] ?? 0,
    openInPanel: panel.open,
    sendPrompt
  }), [getProjectCanvasTicket, inlineFileTicket, panel.open, projectId, revisions, sendPrompt, taskId]);

  return { host, panel };
}
