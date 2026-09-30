import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { API_CACHE_TTLS } from "../../lib/api-cache";
import { badgeClass, formatDateTime } from "../../lib/utils";
import { buildTaskListPath } from "./overview/projectOverviewUtils";
import { DEFAULT_PAGE_SIZE } from "./overview/projectOverviewTypes";
import {
  Play,
  Folder,
  Settings,
  Archive,
  RotateCcw,
  Edit2,
  Plus,
  Search,
  ChevronRight,
  ChevronDown
} from "lucide-react";
import type { Project } from "../../lib/types";

type SortKey = "updated_at" | "created_at" | "name";

function ProjectCard(props: {
  project: Project;
  activeWorkspaceId: string;
  onPrefetchProject: (project: Project) => void;
  busyProjectId: string | null;
  navigate: ReturnType<typeof useNavigate>;
  patchProject: NonNullable<ReturnType<typeof useWorkspaceApp>["patchProject"]>;
  setBusyProjectId: (projectId: string | null) => void;
  setFlash: ReturnType<typeof useWorkspaceApp>["setFlash"];
  setError: (value: string | null) => void;
}) {
  const { project } = props;

  return (
    <article className="workbench-panel padded project-card">
      <div className="project-card-head">
        <div>
          <button
            type="button"
            className="project-card-title"
            onPointerEnter={() => props.onPrefetchProject(project)}
            onFocus={() => props.onPrefetchProject(project)}
            onClick={() => props.navigate(`/app/${props.activeWorkspaceId}/projects/${project.id}`)}
          >
            {project.name}
          </button>
          <div className="project-card-meta">
            <span className={badgeClass(project.status)}>{project.status}</span>
            <span className="muted-text" style={{ fontSize: "0.8rem" }}>
              {project.updated_at
                ? formatDateTime(project.updated_at)
                : project.created_at
                  ? formatDateTime(project.created_at)
                  : "just now"}
            </span>
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={() => {
            const nextName = window.prompt("Rename project", project.name);
            if (!nextName || !nextName.trim()) return;
            props.setBusyProjectId(project.id);
            props.patchProject(project.id, { name: nextName.trim() })
              .then(() => props.setFlash({ tone: "success", text: "Project renamed." }))
              .catch((err) => props.setError(err instanceof Error ? err.message : String(err)))
              .finally(() => props.setBusyProjectId(null));
          }}
          disabled={props.busyProjectId === project.id}
          title="Rename"
        >
          <Edit2 size={16} />
        </button>
      </div>

      <div className="project-card-actions">
        <button
          className="btn ghost"
          onClick={() => props.navigate(`/app/${props.activeWorkspaceId}/projects/${project.id}/tasks/new`)}
          title="New Task"
        >
          <Play size={16} /> Task
        </button>
        <button
          className="btn ghost"
          onClick={() => props.navigate(`/app/${props.activeWorkspaceId}/projects/${project.id}/files`)}
          title="Files"
        >
          <Folder size={16} />
        </button>
        <button
          className="btn ghost"
          onClick={() => props.navigate(`/app/${props.activeWorkspaceId}/projects/${project.id}/settings`)}
          title="Settings"
        >
          <Settings size={16} />
        </button>

        <button
          className={`btn ghost ${project.status === "archived" ? "" : "danger-outline"}`}
          onClick={() => {
            const nextStatus = project.status === "archived" ? "active" : "archived";
            props.setBusyProjectId(project.id);
            props.patchProject(project.id, { status: nextStatus })
              .then(() =>
                props.setFlash({
                  tone: "success",
                  text: nextStatus === "archived" ? "Project archived." : "Project restored."
                })
              )
              .catch((err) => props.setError(err instanceof Error ? err.message : String(err)))
              .finally(() => props.setBusyProjectId(null));
          }}
          disabled={props.busyProjectId === project.id}
          title={project.status === "archived" ? "Restore" : "Archive"}
        >
          {project.status === "archived" ? <RotateCcw size={16} /> : <Archive size={16} />}
        </button>
      </div>
    </article>
  );
}

export function ProjectIndexPage() {
  const workspaceApp = useWorkspaceApp();
  const { activeWorkspaceId, api, setFlash } = workspaceApp;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const createProject = workspaceApp.createProject ?? workspaceApp.createEnvironment;
  const patchProject = workspaceApp.patchProject ?? workspaceApp.patchEnvironment;
  const navigate = useNavigate();
  const [draftName, setDraftName] = useState("");
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const createProjectRequestRef = useRef<Promise<void> | null>(null);

  async function createFromPage(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmedName = draftName.trim();
    if (!trimmedName || createProjectRequestRef.current) return;

    setError(null);
    setIsCreatingProject(true);

    const request = createProject(trimmedName);
    createProjectRequestRef.current = request;

    try {
      await request;
      setDraftName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (createProjectRequestRef.current === request) {
        createProjectRequestRef.current = null;
      }
      setIsCreatingProject(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? projects.filter((e) => e.name.toLowerCase().includes(q)) : [...projects];
    list.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      const aVal = sortKey === "updated_at" ? (a.updated_at ?? a.created_at ?? "") : (a.created_at ?? "");
      const bVal = sortKey === "updated_at" ? (b.updated_at ?? b.created_at ?? "") : (b.created_at ?? "");
      return bVal.localeCompare(aVal);
    });
    return list;
  }, [projects, search, sortKey]);

  const activeProjects = useMemo(
    () => filtered.filter((project) => project.status !== "archived"),
    [filtered]
  );
  const archivedProjects = useMemo(
    () => filtered.filter((project) => project.status === "archived"),
    [filtered]
  );
  const hasResults = activeProjects.length > 0 || archivedProjects.length > 0;

  function prefetchProject(project: Project): void {
    api.primeGet?.(`/api/projects/${project.id}`, project);
    void api.prefetchGet?.(`/api/workspaces/${activeWorkspaceId}/bootstrap?projectId=${project.id}`, {
      ttlMs: API_CACHE_TTLS.workspaceMetadata
    }).catch(() => {});
    void api.prefetchGet?.(buildTaskListPath({
      projectId: project.id,
      query: "",
      status: [],
      taskType: [],
      folderFilter: "all",
      scope: "active",
      sortBy: "updated_at",
      sortDir: "desc",
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE
    }), { ttlMs: API_CACHE_TTLS.taskList }).catch(() => {});
  }

  return (
    <section className="workbench-page">
      <div className="workbench-header">
        <div className="workbench-title-block">
          <span className="workbench-kicker">Workspace</span>
          <h1 className="workbench-title">Projects</h1>
          <p className="workbench-subtitle">Open a project, start a task, or jump into files and terminal tools.</p>
        </div>
      </div>

      <div className="workbench-toolbar">
        <div className="workbench-search">
          <Search size={15} />
          <input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="btn ghost env-sort-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="updated_at">Recently updated</option>
          <option value="created_at">Recently created</option>
          <option value="name">Name A–Z</option>
        </select>
        <form data-onboarding-id="create-project-form" onSubmit={createFromPage} className="env-create-inline">
          <input
            placeholder="New project name..."
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            disabled={isCreatingProject}
          />
          <button
            className="btn primary"
            type="submit"
            disabled={!draftName.trim() || isCreatingProject}
            title={isCreatingProject ? "Creating project" : "Create project"}
          >
            <Plus size={15} /> {isCreatingProject ? "Creating…" : "Create"}
          </button>
        </form>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="project-index-grid">
        {activeProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            activeWorkspaceId={activeWorkspaceId}
            onPrefetchProject={prefetchProject}
            busyProjectId={busyProjectId}
            navigate={navigate}
            patchProject={patchProject}
            setBusyProjectId={setBusyProjectId}
            setFlash={setFlash}
            setError={setError}
          />
        ))}

        {archivedProjects.length > 0 ? (
          <article className="workbench-panel padded project-archive-panel">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setArchivedExpanded((value) => !value)}
              style={{ justifyContent: "space-between", width: "100%" }}
              title={archivedExpanded ? "Hide archived projects" : "Show archived projects"}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                {archivedExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                Archived projects
              </span>
              <span className="muted-text">{archivedProjects.length}</span>
            </button>

            {archivedExpanded ? (
              <div className="project-index-grid">
                {archivedProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    activeWorkspaceId={activeWorkspaceId}
                    onPrefetchProject={prefetchProject}
                    busyProjectId={busyProjectId}
                    navigate={navigate}
                    patchProject={patchProject}
                    setBusyProjectId={setBusyProjectId}
                    setFlash={setFlash}
                    setError={setError}
                  />
                ))}
              </div>
            ) : null}
          </article>
        ) : null}

        {!hasResults && (
          <article className="workbench-empty">
            {search ? (
              <>
                <h4>No results</h4>
                <p>No projects match &ldquo;{search}&rdquo;.</p>
              </>
            ) : (
              <>
                <h4>No projects yet</h4>
                <p>Create one to start running tasks.</p>
              </>
            )}
          </article>
        )}
      </div>
    </section>
  );
}

export const EnvironmentIndexPage = ProjectIndexPage;
