import { useState, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TaskSearchInputBar } from "../../components/search/TaskSearchInputBar";
import { useCompactViewport } from "../../hooks/useCompactViewport";
import type { Project } from "../../lib/types";
import { TaskDetailPage } from "../task/TaskDetailPage";
import { ProjectTaskPane } from "./ProjectTaskPane";
import { useProjectTaskPaneWidth } from "./useProjectTaskPaneWidth";

interface ProjectMasterLandingProps {
  workspaceId: string;
  project: Project | null;
  masterTaskId: string | null;
}

// A project's landing page: the task list on the left and the Master conversation on the right.
// Touch-sized viewports have no room for both, so they keep a compact search row above the conversation.
export function ProjectMasterLanding(props: ProjectMasterLandingProps) {
  const compact = useCompactViewport();
  if (compact || !props.project) return <ProjectMasterStackedLanding {...props} />;
  return <ProjectMasterSplitLanding {...props} project={props.project} />;
}

function ProjectMasterConversation({ masterTaskId }: { masterTaskId: string | null }) {
  return (
    <div className="project-master-conversation">
      {masterTaskId ? <TaskDetailPage key={masterTaskId} taskId={masterTaskId} embedded /> : null}
    </div>
  );
}

function ProjectMasterSplitLanding(props: ProjectMasterLandingProps & { project: Project }) {
  const pane = useProjectTaskPaneWidth();
  return (
    <section
      className="project-master-landing is-split"
      style={{ "--project-task-pane-width": `${pane.width}px` } as CSSProperties}
    >
      <ProjectTaskPane project={props.project} masterTaskId={props.masterTaskId} />
      <div
        className="project-split-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize task list"
        aria-valuenow={pane.width}
        aria-valuemin={pane.minWidth}
        aria-valuemax={pane.maxWidth}
        tabIndex={0}
        onPointerDown={pane.handlePointerDown}
        onKeyDown={pane.handleKeyDown}
        onDoubleClick={pane.reset}
      />
      <ProjectMasterConversation masterTaskId={props.masterTaskId} />
    </section>
  );
}

function ProjectMasterStackedLanding(props: ProjectMasterLandingProps) {
  const { workspaceId, project, masterTaskId } = props;
  const navigate = useNavigate();
  const [searchDraft, setSearchDraft] = useState("");
  const base = `/app/${workspaceId}/projects/${project?.id}`;
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
          <button className="btn ghost project-master-all-tasks" onClick={() => navigate(`${base}/tasks`)}>
            All Tasks
          </button>
          <button className="btn primary project-master-new-task" onClick={() => navigate(`${base}/tasks/new`)}>
            <Plus size={16} />
            <span>New Task</span>
          </button>
        </div>
      ) : null}
      <ProjectMasterConversation masterTaskId={masterTaskId} />
    </section>
  );
}
