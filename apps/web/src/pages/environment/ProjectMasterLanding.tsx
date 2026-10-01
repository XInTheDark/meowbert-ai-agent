import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TaskSearchInputBar } from "../../components/search/TaskSearchInputBar";
import type { Project } from "../../lib/types";
import { badgeClass } from "../../lib/utils";
import { TaskDetailPage } from "../task/TaskDetailPage";

// A project's landing page: the task header and search stay put while the Master conversation fills the rest.
export function ProjectMasterLanding(props: { workspaceId: string; project: Project | null; masterTaskId: string | null }) {
  const { workspaceId, project, masterTaskId } = props;
  const navigate = useNavigate();
  const [searchDraft, setSearchDraft] = useState("");
  const projectId = project?.id;
  const base = `/app/${workspaceId}/projects/${projectId}`;
  return (
    <section className="project-master-landing">
      {project ? (
        <div className="project-master-header task-command-panel">
          <div className="project-command-header">
            <div className="project-command-title">
              <h2>Tasks</h2>
              <div className="project-card-meta">
                <span className={badgeClass(project.status)}>{project.status}</span>
                <span className="project-command-path" title={project.root_path ?? "path pending"}>
                  {project.root_path ?? "path pending"}
                </span>
              </div>
            </div>
            <div className="workbench-actions">
              <button className="btn ghost" onClick={() => navigate(`${base}/tasks`)}>All tasks</button>
              <button className="btn primary" onClick={() => navigate(`${base}/tasks/new`)}>New Task</button>
            </div>
          </div>
          <div className="task-toolbar">
            <TaskSearchInputBar
              value={searchDraft}
              onChange={setSearchDraft}
              onSubmit={() => {
                const query = searchDraft.trim();
                navigate(query ? `${base}/tasks?q=${encodeURIComponent(query)}` : `${base}/tasks`);
              }}
              placeholder="Search tasks and conversation history..."
            />
          </div>
        </div>
      ) : null}
      <div className="project-master-conversation">
        {masterTaskId ? <TaskDetailPage key={masterTaskId} taskId={masterTaskId} embedded /> : null}
      </div>
    </section>
  );
}
