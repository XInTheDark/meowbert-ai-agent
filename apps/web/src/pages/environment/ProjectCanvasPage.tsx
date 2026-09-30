import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FolderOpen, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import {
  ProjectCanvasDevServerStatus,
  ProjectCanvasResponse,
  ProjectCanvasSummary,
  TaskDetail,
  TaskMessage
} from "../../lib/types";
import { buildProjectCanvasPreviewUrl, fetchProjectCanvasPreviewTicket } from "../../lib/projectCanvases";
import { formatRelative, joinTaskMessage } from "../../lib/utils";

function buildCanvasAttachment(canvas: ProjectCanvasSummary) {
  return {
    id: crypto.randomUUID(),
    kind: "canvas" as const,
    label: canvas.name,
    content: `Canvas: ${canvas.name}`,
    relativePath: canvas.rootPath
  };
}

function readMessageText(message: TaskMessage): string {
  const value = message.content_json;
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  const content = value.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const candidate = item as Record<string, unknown>;
        return typeof candidate.text === "string" ? candidate.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

export function ProjectCanvasPage() {
  const { workspaceId, projectId, canvasId } = useParams();
  const { api, token, setFlash } = useWorkspaceApp();
  const navigate = useNavigate();
  const [canvas, setCanvas] = useState<ProjectCanvasSummary | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [devStatus, setDevStatus] = useState<ProjectCanvasDevServerStatus | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [message, setMessage] = useState("");
  const [mobileTab, setMobileTab] = useState<"preview" | "chat">("preview");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const activeTaskId = taskDetail?.task.id ?? canvas?.lastTaskId ?? null;
  const canvasAttachment = useMemo(() => canvas ? buildCanvasAttachment(canvas) : null, [canvas?.id, canvas?.name, canvas?.rootPath]);

  const loadCanvasTask = useCallback(async (nextCanvas: ProjectCanvasSummary) => {
    if (!nextCanvas.lastTaskId) {
      setTaskDetail(null);
      return;
    }
    const detail = await api.get<TaskDetail>(`/api/tasks/${nextCanvas.lastTaskId}?messageDetail=full`);
    setTaskDetail(detail);
  }, [api]);

  const loadCanvas = useCallback(async () => {
    if (!projectId || !canvasId) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [canvasResponse, ticketResponse] = await Promise.all([
        api.get<ProjectCanvasResponse>(`/api/projects/${projectId}/canvases/${canvasId}`),
        fetchProjectCanvasPreviewTicket(projectId, canvasId, token)
      ]);
      setCanvas(canvasResponse.canvas);
      setPreviewUrl(buildProjectCanvasPreviewUrl(
        projectId,
        canvasId,
        ticketResponse.ticket,
        canvasResponse.canvas.runtimeMode === "static" ? canvasResponse.canvas.entryPath : null
      ));
      if (canvasResponse.canvas.runtimeMode === "dev_server") {
        const status = await api.get<ProjectCanvasDevServerStatus>(`/api/projects/${projectId}/canvases/${canvasId}/dev-server/status`);
        setDevStatus(status);
      } else {
        setDevStatus(null);
      }
      await loadCanvasTask(canvasResponse.canvas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [api, canvasId, loadCanvasTask, projectId, token]);

  useEffect(() => {
    void loadCanvas();
  }, [loadCanvas, refreshKey]);

  const submitCanvasTask = useCallback(async (prompt: string, title?: string | null) => {
    if (!projectId || !canvas || !canvasAttachment || prompt.trim().length === 0) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      if (activeTaskId) {
        const response = await api.post<{ taskId: string }>(`/api/tasks/${activeTaskId}/messages`, {
          message: joinTaskMessage(prompt, [canvasAttachment]),
          attachments: [canvasAttachment],
          interactiveCanvasId: canvas.id,
          interactiveCanvasIntent: "update"
        });
        const detail = await api.get<TaskDetail>(`/api/tasks/${response.taskId}?messageDetail=full`);
        setTaskDetail(detail);
      } else {
        const created = await api.post<{ taskId: string }>(`/api/projects/${projectId}/tasks`, {
          message: joinTaskMessage(prompt, [canvasAttachment]),
          attachments: [canvasAttachment],
          interactiveCanvasId: canvas.id,
          interactiveCanvasIntent: "update",
          ...(title ? { title } : {})
        });
        const [updatedCanvas, detail] = await Promise.all([
          api.get<ProjectCanvasResponse>(`/api/projects/${projectId}/canvases/${canvas.id}`),
          api.get<TaskDetail>(`/api/tasks/${created.taskId}?messageDetail=full`)
        ]);
        setCanvas(updatedCanvas.canvas);
        setTaskDetail(detail);
      }
      setMessage("");
      api.invalidateGet?.({ pathPrefix: `/api/projects/${projectId}/canvases` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [activeTaskId, api, canvas, canvasAttachment, projectId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }
      const data = payload as Record<string, unknown>;
      if (data.type !== "meowbert-canvas-run" || data.canvasId !== canvasId || typeof data.prompt !== "string") {
        return;
      }
      if (data.userGesture !== true) {
        setFlash({ tone: "error", text: "Canvas actions must be triggered by a user gesture." });
        return;
      }
      void submitCanvasTask(data.prompt, typeof data.title === "string" ? data.title : null);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [canvasId, setFlash, submitCanvasTask]);

  async function refreshPreview(): Promise<void> {
    if (!projectId || !canvasId) {
      return;
    }
    const ticketResponse = await fetchProjectCanvasPreviewTicket(projectId, canvasId, token);
    setPreviewUrl(buildProjectCanvasPreviewUrl(
      projectId,
      canvasId,
      ticketResponse.ticket,
      canvas?.runtimeMode === "static" ? canvas.entryPath : null
    ));
    setRefreshKey((value) => value + 1);
  }

  async function setDevServerRunning(running: boolean): Promise<void> {
    if (!projectId || !canvasId) {
      return;
    }
    try {
      const status = await api.post<ProjectCanvasDevServerStatus>(
        `/api/projects/${projectId}/canvases/${canvasId}/dev-server/${running ? "start" : "stop"}`,
        {}
      );
      setDevStatus(status);
      await refreshPreview();
    } catch (err) {
      setFlash({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  const conversationMessages = (taskDetail?.messages ?? []).filter((item) => item.role === "user" || item.role === "assistant");

  if (!projectId || !canvasId || !workspaceId) {
    return <section className="workbench-page"><article className="workbench-empty">Canvas route is incomplete.</article></section>;
  }

  return (
    <section className="canvas-page">
      <header className="canvas-topbar">
        <div className="canvas-title-group">
          <h2>{canvas?.name ?? "Interactive Canvas"}</h2>
          <span className="muted-text">
            {canvas ? `${canvas.runtimeMode === "dev_server" ? "Dev server" : "Static"} · updated ${formatRelative(canvas.updatedAt)}` : "Loading"}
          </span>
        </div>
        <div className="canvas-mobile-tabs" role="tablist" aria-label="Canvas view">
          <button type="button" className={mobileTab === "preview" ? "active" : ""} onClick={() => setMobileTab("preview")}>Preview</button>
          <button type="button" className={mobileTab === "chat" ? "active" : ""} onClick={() => setMobileTab("chat")}>Chat</button>
        </div>
        <div className="canvas-topbar-actions">
          {canvas?.runtimeMode === "dev_server" ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void setDevServerRunning(devStatus?.status !== "running")}
            >
              {devStatus?.status === "running" ? <Square size={15} /> : <Play size={15} />}
              {devStatus?.status === "running" ? "Stop" : "Start"}
            </button>
          ) : null}
          <button type="button" className="btn ghost icon-btn" onClick={() => void refreshPreview()} title="Refresh preview" aria-label="Refresh preview">
            <RefreshCw size={16} />
          </button>
          {canvas ? (
            <button type="button" className="btn ghost" onClick={() => navigate(`/app/${workspaceId}/projects/${projectId}/files?path=${encodeURIComponent(canvas.rootPath)}`)}>
              <FolderOpen size={15} />
              Files
            </button>
          ) : null}
          {previewUrl ? (
            <a className="btn ghost" href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Open
            </a>
          ) : null}
        </div>
      </header>

      <div className="canvas-shell">
        <main className={`canvas-preview-pane ${mobileTab === "preview" ? "mobile-active" : ""}`}>
          {isLoading ? (
            <div className="canvas-loading"><Loader2 className="spin" size={18} /> Loading canvas...</div>
          ) : error ? (
            <div className="error-banner">{error}</div>
          ) : previewUrl ? (
            <iframe
              key={previewUrl}
              className="canvas-preview-frame"
              title={canvas?.name ?? "Interactive Canvas preview"}
              src={previewUrl}
              sandbox="allow-scripts allow-forms allow-modals allow-downloads"
            />
          ) : (
            <div className="canvas-loading">Preview unavailable.</div>
          )}
        </main>

        <aside className={`canvas-chat-pane ${mobileTab === "chat" ? "mobile-active" : ""}`}>
          <div className="canvas-chat-header">
            <strong>Task</strong>
            {activeTaskId ? (
              <button type="button" className="btn ghost" onClick={() => navigate(`/app/${workspaceId}/projects/${projectId}/tasks/${activeTaskId}?taskView=1`)}>
                Open task
              </button>
            ) : null}
          </div>

          <div className="canvas-chat-log">
            {conversationMessages.length === 0 ? (
              <div className="task-list-empty">Ask Meowbert to update this canvas.</div>
            ) : conversationMessages.map((item) => (
              <div key={item.id} className={`canvas-chat-message ${item.role}`}>
                <span>{item.role === "assistant" ? "Meowbert" : "You"}</span>
                <p>{readMessageText(item) || "(empty)"}</p>
              </div>
            ))}
          </div>

          <form
            className="canvas-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCanvasTask(message);
            }}
          >
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Update this canvas..."
              disabled={isSubmitting}
              rows={4}
            />
            <button type="submit" className="btn primary" disabled={isSubmitting || message.trim().length === 0}>
              {isSubmitting ? "Sending..." : "Send"}
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
