import { Maximize2, Plus } from "lucide-react";
import type { Project } from "../../lib/types";
import {
  ProjectTaskDialogs,
  ProjectTaskPagination,
  ProjectTaskToolbar,
  ProjectTaskTree,
  useDismissTaskMenusOnOutsideClick
} from "./overview/ProjectTaskListSections";
import { useProjectTaskBrowser } from "./overview/useProjectTaskBrowser";

// The project's task list as a narrow pane beside the Master conversation. Bulk selection stays on the full Tasks page.
export function ProjectTaskPane(props: { project: Project; masterTaskId: string | null }) {
  const { project, masterTaskId } = props;
  const browser = useProjectTaskBrowser();
  const { activeWorkspaceId, navigate, taskList } = browser;
  const base = `/app/${activeWorkspaceId}/projects/${project.id}`;
  useDismissTaskMenusOnOutsideClick(browser);

  function openFullList(): void {
    const query = taskList.searchTerm.trim();
    navigate(query ? `${base}/tasks?q=${encodeURIComponent(query)}` : `${base}/tasks`);
  }

  return (
    <aside className="project-task-pane" aria-label="Tasks">
      <ProjectTaskToolbar
        project={project}
        browser={browser}
        extraActions={(
          <>
            <button type="button" className="btn ghost icon-btn" onClick={openFullList} title="Open full task list" aria-label="Open full task list">
              <Maximize2 size={15} />
            </button>
            <button type="button" className="btn primary icon-btn" onClick={() => navigate(`${base}/tasks/new`)} title="New task" aria-label="New task">
              <Plus size={16} />
            </button>
          </>
        )}
      />
      {taskList.loadError ? <div className="error-banner">{taskList.loadError}</div> : null}
      <div className="project-task-pane-list">
        <ProjectTaskTree project={project} browser={browser} activeTaskId={masterTaskId} />
      </div>
      <ProjectTaskPagination browser={browser} />
      <ProjectTaskDialogs browser={browser} />
    </aside>
  );
}
