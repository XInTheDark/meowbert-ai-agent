import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CanvasFrame } from "../../../components/canvas/CanvasFrame";
import { getCanvasStorageKey } from "../../../components/canvas/canvasViews";
import type { ProjectCanvasSummary } from "../../../lib/types";
import {
  buildProjectCanvasPreviewUrl,
  fetchProjectCanvasPreviewTicket
} from "../../../lib/projectCanvases";

interface TaskCanvasArtifactPreviewProps {
  canvas: ProjectCanvasSummary;
  projectId: string | null;
  token: string | null;
}

export function TaskCanvasArtifactPreview(props: TaskCanvasArtifactPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const projectId = props.projectId;
    const token = props.token;
    if (!projectId || !token) {
      setPreviewUrl(null);
      setError("Canvas preview is unavailable in the current session.");
      return;
    }

    let cancelled = false;
    setPreviewUrl(null);
    setError(null);
    void fetchProjectCanvasPreviewTicket(projectId, props.canvas.id, token)
      .then((ticket) => {
        if (!cancelled) setPreviewUrl(buildProjectCanvasPreviewUrl(projectId, props.canvas.id, ticket.ticket, props.canvas.entryPath));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [props.canvas.entryPath, props.canvas.id, props.projectId, props.token]);

  if (error) {
    return (
      <div className="empty-hint task-artifact-preview-message">
        <p>{error}</p>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="task-artifact-preview-message">
        <Loader2 className="spin" size={18} aria-hidden="true" />
        <p>Loading canvas...</p>
      </div>
    );
  }

  return (
    <CanvasFrame
      src={previewUrl}
      srcKey={`canvas:${props.canvas.id}:${props.canvas.entryPath}`}
      title={`${props.canvas.name} preview`}
      storageKey={getCanvasStorageKey({ canvasId: props.canvas.id, relativePath: props.canvas.entryPath }, null)}
      sizing={{ mode: "fill" }}
    />
  );
}
