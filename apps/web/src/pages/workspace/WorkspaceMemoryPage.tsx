import { useCallback, useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { badgeClass, formatDateTime } from "../../lib/utils";

interface MemoryFile {
  path: string;
  content: string;
}

interface MemoryRefresh {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  task_id: string | null;
  created_at: string;
  completed_at: string | null;
  error_summary: string | null;
}

interface WorkspaceMemoryResponse {
  enabled: boolean;
  workspace: MemoryFile | null;
  project: MemoryFile | null;
  latestRefresh: MemoryRefresh | null;
  recentRefreshes: MemoryRefresh[];
}

export function WorkspaceMemoryPage() {
  const { api, activeWorkspaceId, activeProjectId, environments, setFlash } = useWorkspaceApp();
  const navigate = useNavigate();
  const [data, setData] = useState<WorkspaceMemoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(activeProjectId ?? "");

  const selectedProject = environments.find((project) => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (activeProjectId) {
      setSelectedProjectId(activeProjectId);
    }
  }, [activeProjectId]);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      const params = selectedProjectId ? `?projectId=${encodeURIComponent(selectedProjectId)}` : "";
      setData(await api.get<WorkspaceMemoryResponse>(`/api/workspaces/${activeWorkspaceId}/memory${params}`));
    } catch (error) {
      setFlash({ tone: "error", text: error instanceof Error ? error.message : "Unable to load Memory." });
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, api, selectedProjectId, setFlash]);

  useEffect(() => {
    void load();
  }, [load]);

  const queueRefresh = useCallback(async () => {
    if (!activeWorkspaceId || !selectedProjectId) {
      return;
    }
    setRefreshing(true);
    try {
      const response = await api.post<{ queued: boolean }>(`/api/workspaces/${activeWorkspaceId}/memory/refresh`, {
        projectId: selectedProjectId
      });
      setFlash({ tone: "success", text: response.queued ? "Memory refresh queued." : "A Memory refresh is already in progress." });
      await load();
    } catch (error) {
      setFlash({ tone: "error", text: error instanceof Error ? error.message : "Unable to refresh Memory." });
    } finally {
      setRefreshing(false);
    }
  }, [activeWorkspaceId, api, load, selectedProjectId, setFlash]);

  if (loading) {
    return <section className="page-content"><article className="section-card"><p className="muted-text">Loading Memory…</p></article></section>;
  }

  if (!data?.enabled) {
    return (
      <section className="page-content">
        <article className="section-card stack-form" style={{ maxWidth: "52rem" }}>
          <div>
            <h3>Memory</h3>
            <p className="muted-text">Enable Workspace Memory in Workspace Settings to keep durable workspace and Project notes.</p>
          </div>
          <div className="row-actions">
            <button className="btn primary" type="button" onClick={() => navigate(`/app/${activeWorkspaceId}/settings`)}>Open Workspace Settings</button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="page-content">
      <article className="section-card stack-form">
        <div className="section-head">
          <div>
            <h3>Memory</h3>
            <p className="muted-text">Workspace notes and durable notes for a selected Project.</p>
          </div>
          <div className="row-actions">
            <button className="btn ghost" type="button" onClick={() => navigate(`/app/${activeWorkspaceId}/files?path=.memory`)}>
              <FolderOpen size={16} /> Open in Files
            </button>
            <button className="btn primary" type="button" disabled={!selectedProjectId || refreshing} onClick={() => void queueRefresh()}>
              <RefreshCw size={16} /> {refreshing ? "Queueing…" : "Refresh memory"}
            </button>
          </div>
        </div>

        <label>
          <strong>Project</strong>
          <select
            className="toolbar-select"
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            <option value="">Select a Project</option>
            {environments.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>

        <MemoryFileSection title="Workspace MEMORY.md" file={data.workspace} />
        <MemoryFileSection
          title={selectedProject ? `${selectedProject.name} MEMORY.md` : "Project MEMORY.md"}
          file={data.project}
          emptyText="Choose a Project to view its durable notes and refresh history."
        />

        {selectedProject ? <RecentSynthesisRuns runs={data.recentRefreshes} workspaceId={activeWorkspaceId} projectId={selectedProject.id} onOpenTask={navigate} /> : null}
      </article>
    </section>
  );
}

function MemoryFileSection(props: { title: string; file: MemoryFile | null; emptyText?: string }) {
  return (
    <section className="stack-form" style={{ gap: "0.7rem" }}>
      <div>
        <h4 style={{ margin: 0 }}>{props.title}</h4>
        {props.file ? <p className="hint-text" style={{ margin: "0.2rem 0 0" }}>{props.file.path}</p> : null}
      </div>
      {props.file ? <pre className="memory-file-preview">{props.file.content}</pre> : <p className="muted-text">{props.emptyText ?? "Memory is unavailable."}</p>}
    </section>
  );
}

function RecentSynthesisRuns(props: {
  runs: MemoryRefresh[];
  workspaceId: string | null;
  projectId: string;
  onOpenTask: (path: string) => void;
}) {
  return (
    <section className="stack-form" style={{ gap: "0.7rem" }}>
      <div>
        <h4 style={{ margin: 0 }}>Recent synthesizer runs</h4>
        <p className="hint-text" style={{ margin: "0.2rem 0 0" }}>Memory refresh tasks for this Project.</p>
      </div>
      {props.runs.length === 0 ? <p className="muted-text">No Memory refreshes have run for this Project yet.</p> : (
        <div className="table-container">
          <div className="table-list">
            {props.runs.map((run) => (
              <div className="table-row static" key={run.id}>
                <div>
                  <strong>Refresh memory</strong>
                  <p className="hint-text" style={{ margin: "0.2rem 0 0" }}>
                    {run.completed_at ? `Completed ${formatDateTime(run.completed_at)}` : `Started ${formatDateTime(run.created_at)}`}
                  </p>
                </div>
                <span className={badgeClass(run.status)}>{run.status}</span>
                <span className="muted-text">{run.error_summary ?? ""}</span>
                {run.task_id && props.workspaceId ? (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => props.onOpenTask(`/app/${props.workspaceId}/projects/${props.projectId}/tasks/${run.task_id}`)}
                  >
                    Open task
                  </button>
                ) : <span className="muted-text">Task pending</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
