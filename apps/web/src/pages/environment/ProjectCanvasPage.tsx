import { useEffect, useState } from "react";
import { ArrowUp, FolderOpen, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { CanvasFrame } from "../../components/canvas/CanvasFrame";
import { getCanvasStorageKey } from "../../components/canvas/canvasViews";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { buildProjectCanvasPreviewUrl, fetchProjectCanvasPreviewTicket } from "../../lib/projectCanvases";
import type { ProjectCanvasResponse, ProjectCanvasSummary } from "../../lib/types";
import { joinTaskMessage } from "../../lib/utils";
import { buildTaskRoutePath } from "../../task/taskRouteContext";

function buildCanvasAttachment(canvas: ProjectCanvasSummary) {
  return {
    id: crypto.randomUUID(),
    kind: "canvas" as const,
    label: canvas.name,
    content: `Canvas: ${canvas.name}`,
    relativePath: canvas.rootPath
  };
}

function useCanvasStarter(projectId: string, canvas: ProjectCanvasSummary | null, openTask: (taskId: string) => void) {
  const { api } = useWorkspaceApp();
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!canvas || !prompt.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const attachment = buildCanvasAttachment(canvas);
      const created = await api.post<{ taskId: string }>(`/api/projects/${projectId}/tasks`, {
        message: joinTaskMessage(prompt, [attachment]),
        attachments: [attachment],
        interactiveCanvasId: canvas.id,
        interactiveCanvasIntent: "update"
      });
      api.invalidateGet?.({ pathPrefix: `/api/projects/${projectId}/canvases` });
      openTask(created.taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
    }
  }

  return { prompt, setPrompt, isSubmitting, error, submit };
}

/** A project canvas on its own. With a task behind it, it opens that task with the canvas beside it. */
export function ProjectCanvasPage() {
  const { workspaceId, projectId, canvasId } = useParams();
  const { api, token } = useWorkspaceApp();
  const navigate = useNavigate();
  const [canvas, setCanvas] = useState<ProjectCanvasSummary | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openTask = (taskId: string) => {
    if (!workspaceId || !projectId || !canvasId) return;
    navigate(`${buildTaskRoutePath({ workspaceId, projectId, taskId })}?canvas=${encodeURIComponent(canvasId)}`, { replace: true });
  };
  const starter = useCanvasStarter(projectId ?? "", canvas, openTask);

  useEffect(() => {
    if (!projectId || !canvasId || !token) return;
    let cancelled = false;
    void Promise.all([
      api.get<ProjectCanvasResponse>(`/api/projects/${projectId}/canvases/${canvasId}`),
      fetchProjectCanvasPreviewTicket(projectId, canvasId, token)
    ]).then(([response, ticket]) => {
      if (cancelled) return;
      if (response.canvas.lastTaskId) {
        openTask(response.canvas.lastTaskId);
        return;
      }
      setCanvas(response.canvas);
      setPreviewUrl(buildProjectCanvasPreviewUrl(projectId, canvasId, ticket.ticket, response.canvas.entryPath));
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [api, canvasId, projectId, token]);

  if (error) return <section className="workbench-page"><div className="error-banner">{error}</div></section>;
  if (!canvas || !previewUrl || !workspaceId || !projectId) {
    return <section className="canvas-page"><div className="canvas-card-unavailable"><Loader2 className="spin" size={16} /> Loading canvas…</div></section>;
  }

  return (
    <section className="canvas-page">
      <header className="canvas-page-header">
        <strong>{canvas.name}</strong>
        <button type="button" className="icon-btn" title="Files" aria-label="Files"
          onClick={() => navigate(`/app/${workspaceId}/projects/${projectId}/files?path=${encodeURIComponent(canvas.rootPath)}`)}>
          <FolderOpen size={15} aria-hidden="true" />
        </button>
      </header>
      <div className="canvas-page-body">
        <CanvasFrame src={previewUrl} srcKey={`canvas:${canvas.id}:${canvas.entryPath}`} title={canvas.name}
          storageKey={getCanvasStorageKey({ canvasId: canvas.id, relativePath: canvas.entryPath }, null)} sizing={{ mode: "fill" }} />
      </div>
      <form className="canvas-page-starter" onSubmit={(event) => {
        event.preventDefault();
        void starter.submit();
      }}>
        <input value={starter.prompt} onChange={(event) => starter.setPrompt(event.target.value)}
          placeholder="Ask Meowbert to change this canvas" disabled={starter.isSubmitting} aria-label="Ask Meowbert to change this canvas" />
        <button type="submit" className="btn primary icon-btn" disabled={starter.isSubmitting || !starter.prompt.trim()} aria-label="Send">
          {starter.isSubmitting ? <Loader2 className="spin" size={15} /> : <ArrowUp size={15} />}
        </button>
        {starter.error ? <p className="error-text">{starter.error}</p> : null}
      </form>
    </section>
  );
}
