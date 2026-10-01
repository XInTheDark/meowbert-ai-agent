import { useState } from "react";
import { ListTodo, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TaskSearchInputBar } from "../../components/search/TaskSearchInputBar";
import type { Project } from "../../lib/types";
import { TaskDetailPage } from "../task/TaskDetailPage";

// A project's landing page: one compact search/actions row stays put while the Master conversation fills the rest.
export function ProjectMasterLanding(props: { workspaceId: string; project: Project | null; masterTaskId: string | null }) {
  const { workspaceId, project, masterTaskId } = props;
  const navigate = useNavigate();
  const [searchDraft, setSearchDraft] = useState("");
  const projectId = project?.id;
  const base = `/app/${workspaceId}/projects/${projectId}`;
  return (
    <section className="project-master-landing">
      {project ? (
        <div className="project-master-header">
          <TaskSearchInputBar
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={() => {
              const query = searchDraft.trim();
              navigate(query ? `${base}/tasks?q=${encodeURIComponent(query)}` : `${base}/tasks`);
            }}
            placeholder="Search tasks and conversation history..."
          />
          <button className="btn ghost icon-btn" onClick={() => navigate(`${base}/tasks`)} title="All tasks" aria-label="All tasks">
            <ListTodo size={16} />
          </button>
          <button className="btn primary project-master-new-task" onClick={() => navigate(`${base}/tasks/new`)}>
            <Plus size={16} />
            <span>New Task</span>
          </button>
        </div>
      ) : null}
      <div className="project-master-conversation">
        {masterTaskId ? <TaskDetailPage key={masterTaskId} taskId={masterTaskId} embedded /> : null}
      </div>
    </section>
  );
}
