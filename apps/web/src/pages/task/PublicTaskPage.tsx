import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createApiClient } from "../../lib/api";
import { TaskConversationMessages } from "../../components/taskConversation/TaskConversationMessages";
import { buildPublicTaskInlineFileUrl } from "../../lib/taskInlineFiles";
import { Project, TaskDetail, Workspace } from "../../lib/types";
import { badgeClass, formatDateTime, formatRelative, formatTaskTypeLabel } from "../../lib/utils";

const LAST_WORKSPACE_KEY = "meowbert_last_workspace";
const DEFAULT_FORK_ENVIRONMENT_NAME = "Default project";

export function PublicTaskPage(props: { token: string | null }) {
  const params = useParams<{ shareId: string }>();
  const shareId = params.shareId ?? "";
  const navigate = useNavigate();
  const api = useMemo(() => createApiClient(null), []);
  const authedApi = useMemo(() => createApiClient(props.token), [props.token]);

  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isForking, setIsForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveForkProject = useCallback(async (): Promise<{ workspaceId: string; projectId: string }> => {
    const me = await authedApi.get<{ workspaces: Workspace[] }>("/api/auth/me");
    const rememberedWorkspaceId =
      typeof window !== "undefined" ? window.localStorage.getItem(LAST_WORKSPACE_KEY) : null;
    const preferredWorkspace = me.workspaces.find((workspace) => workspace.id === rememberedWorkspaceId) ?? me.workspaces[0];

    if (!preferredWorkspace) {
      throw new Error("No workspace available for forking.");
    }

    const projects = await authedApi.get<{ items: Project[] }>(
      `/api/workspaces/${preferredWorkspace.id}/projects`
    );
    const existingProjectId = projects.items.find((project) => project.status !== "archived")?.id;
    if (existingProjectId) {
      return {
        workspaceId: preferredWorkspace.id,
        projectId: existingProjectId
      };
    }

    const createdProject = await authedApi.post<{ id: string }>(
      `/api/workspaces/${preferredWorkspace.id}/projects`,
      { name: DEFAULT_FORK_ENVIRONMENT_NAME }
    );

    return {
      workspaceId: preferredWorkspace.id,
      projectId: createdProject.id
    };
  }, [authedApi]);

  const loadTask = useCallback(async () => {
    if (!shareId) {
      setError("Invalid shared link.");
      setTaskDetail(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const detail = await api.get<TaskDetail>(`/api/public/tasks/${shareId}`);
      setTaskDetail(detail);
      setError(null);
    } catch (err) {
      setTaskDetail(null);
      setError(err instanceof Error ? err.message : "Failed to load shared task.");
    } finally {
      setIsLoading(false);
    }
  }, [api, shareId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  const handleForkTask = useCallback(async () => {
    if (!taskDetail?.task.id) {
      return;
    }

    if (!props.token) {
      navigate("/auth");
      return;
    }

    setIsForking(true);
    setError(null);
    try {
      const destination = await resolveForkProject();
      const created = await authedApi.post<{
        taskId: string;
        workspaceId: string;
        environmentId: string;
      }>(`/api/public/tasks/${shareId}/fork`, {
        environmentId: destination.projectId,
        copyTaskFiles: false
      });

      navigate(`/app/${created.workspaceId}/projects/${created.environmentId}/tasks/${created.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fork shared task.");
    } finally {
      setIsForking(false);
    }
  }, [authedApi, navigate, props.token, resolveForkProject, shareId, taskDetail?.task.id]);

  return (
    <main className="public-task-shell">
      <section className="public-task-header">
        <div>
          <p className="muted-text" style={{ margin: 0, fontSize: "0.85rem" }}>Shared Task</p>
          <h1 style={{ margin: "0.2rem 0 0 0", fontSize: "1.5rem" }}>Meowbert</h1>
        </div>
        <div className="public-task-header-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void handleForkTask();
            }}
            disabled={isLoading || isForking || !taskDetail}
          >
            {isForking ? "Forking task..." : "Fork task"}
          </button>
        </div>
      </section>

      {isLoading ? (
        <section className="section-card empty-card">
          <h3>Loading shared task...</h3>
        </section>
      ) : taskDetail ? (
        <>
          {error ? (
            <section className="section-card empty-card" style={{ padding: "0.9rem 1rem" }}>
              <p className="error-text" style={{ margin: 0 }}>{error}</p>
            </section>
          ) : null}
          <section className="section-card public-task-summary">
            <div className="public-task-summary-head">
              <div>
                <h2 style={{ margin: 0 }}>{taskDetail.task.title || "Untitled Task"}</h2>
                <div className="public-task-badges">
                  <span className={badgeClass(taskDetail.task.status)}>{taskDetail.task.status}</span>
                  <span className="badge muted">public</span>
                  {taskDetail.task.task_type && taskDetail.task.task_type !== "standard" ? (
                    <span className="badge muted">{formatTaskTypeLabel(taskDetail.task.task_type)}</span>
                  ) : null}
                </div>
              </div>
              <span className="muted-text">Updated {formatRelative(taskDetail.task.updated_at)}</span>
            </div>

            <div className="public-task-meta-grid">
              <div>
                <span className="stat-label">Created</span>
                <strong>{formatDateTime(taskDetail.task.created_at)}</strong>
              </div>
              <div>
                <span className="stat-label">Updated</span>
                <strong>{formatDateTime(taskDetail.task.updated_at)}</strong>
              </div>
              <div>
                <span className="stat-label">Runs</span>
                <strong>{taskDetail.runs.length}</strong>
              </div>
              <div>
                <span className="stat-label">Messages</span>
                <strong>{taskDetail.messages.length}</strong>
              </div>
            </div>
          </section>

          <section className="section-card public-task-conversation">
            <div className="public-task-conversation-head">
              <h3 style={{ margin: 0 }}>Conversation</h3>
              <span className="muted-text" style={{ fontSize: "0.82rem" }}>Read-only</span>
            </div>

            <div className="chat-feed public-task-chat-feed">
              {taskDetail.messages.length === 0 ? (
                <p className="empty-hint">No messages yet.</p>
              ) : (
                <TaskConversationMessages
                  messages={taskDetail.messages}
                  buildInlineArtifactUrl={(relativePath) => (
                    shareId ? buildPublicTaskInlineFileUrl(shareId, relativePath) : null
                  )}
                />
              )}
            </div>
          </section>
        </>
      ) : error ? (
        <section className="section-card empty-card">
          <h3>Could not load shared task</h3>
          <p className="muted-text">{error}</p>
        </section>
      ) : (
        <section className="section-card empty-card">
          <h3>Task unavailable</h3>
          <p className="muted-text">This share link may have been disabled.</p>
        </section>
      )}
    </main>
  );
}
