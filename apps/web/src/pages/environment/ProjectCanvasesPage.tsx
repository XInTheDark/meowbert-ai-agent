import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import type { ProjectCanvasListResponse, ProjectCanvasSummary } from "../../lib/types";
import { ProjectCanvasOverviewTab } from "./overview/ProjectCanvasOverviewTab";

export function ProjectCanvasesPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId } = workspaceApp;
  const projectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const project = projects.find((item) => item.id === projectId) ?? null;
  const navigate = useNavigate();
  const [canvases, setCanvases] = useState<ProjectCanvasSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setCanvases([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void api.get<ProjectCanvasListResponse>(`/api/projects/${projectId}/canvases`)
      .then((response) => {
        if (!cancelled) {
          setCanvases(response.items);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCanvases([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, projectId, refreshNonce]);

  if (!projectId || !project) {
    return (
      <section className="workbench-page">
        <article className="workbench-empty">Select a project to view canvases.</article>
      </section>
    );
  }

  return (
    <section className="workbench-page">
      <article className="workbench-panel padded task-command-panel">
        <div className="project-command-header">
          <div className="project-command-title">
            <span className="workbench-kicker">{project.name}</span>
            <h2>Canvases</h2>
          </div>
          <div className="workbench-actions">
            <button
              className="btn primary"
              onClick={() => navigate(`/app/${activeWorkspaceId}/projects/${projectId}/tasks/new?canvasMode=1`)}
            >
              New canvas
            </button>
            <button
              type="button"
              className="btn ghost icon-btn"
              onClick={() => setRefreshNonce((value) => value + 1)}
              disabled={isLoading}
              title="Refresh"
              aria-label="Refresh canvases"
            >
              <RotateCw size={16} />
            </button>
          </div>
        </div>

        {error ? <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div> : null}
        <ProjectCanvasOverviewTab
          canvases={canvases}
          isLoading={isLoading}
          onOpen={(canvasId) => navigate(`/app/${activeWorkspaceId}/projects/${projectId}/canvases/${canvasId}`)}
          onContinue={(canvasId) => navigate(`/app/${activeWorkspaceId}/projects/${projectId}/tasks/new?canvasMode=1&canvasId=${encodeURIComponent(canvasId)}`)}
        />
      </article>
    </section>
  );
}
