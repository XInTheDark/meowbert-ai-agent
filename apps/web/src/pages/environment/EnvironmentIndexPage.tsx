import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { API_CACHE_TTLS } from "../../lib/api-cache";
import type { Project } from "../../lib/types";
import { buildTaskListPath } from "./overview/projectOverviewUtils";
import { DEFAULT_PAGE_SIZE } from "./overview/projectOverviewTypes";
import { ProjectCard } from "./projects/ProjectCard";
import { useProjectCardMenu } from "./projects/useProjectCardMenu";

type SortKey = "updated_at" | "created_at" | "name";

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
  const cardMenu = useProjectCardMenu();

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

  async function updateProject(project: Project, patch: { name?: string; status?: "active" | "archived" }, successText: string): Promise<void> {
    setBusyProjectId(project.id);
    try {
      await patchProject(project.id, patch);
      setFlash({ tone: "success", text: successText });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectId(null);
    }
  }

  function renderCard(project: Project) {
    const base = `/app/${activeWorkspaceId}/projects/${project.id}`;
    const archived = project.status === "archived";
    return (
      <ProjectCard
        key={project.id}
        project={project}
        busy={busyProjectId === project.id}
        isMenuOpen={cardMenu.openMenuProjectId === project.id}
        onMenuOpenChange={(open) => cardMenu.setMenuOpen(project.id, open)}
        onOpen={() => navigate(base)}
        onPrefetch={() => prefetchProject(project)}
        onNewTask={() => navigate(`${base}/tasks/new`)}
        onOpenFiles={() => navigate(`${base}/files`)}
        onOpenSettings={() => navigate(`${base}/settings`)}
        onRename={(name) => updateProject(project, { name }, "Project renamed.")}
        onToggleArchived={() => void updateProject(
          project,
          { status: archived ? "active" : "archived" },
          archived ? "Project restored." : "Project archived."
        )}
      />
    );
  }

  return (
    <section className="workbench-page">
      <div className="workbench-header">
        <div className="workbench-title-block">
          <span className="workbench-kicker">Workspace</span>
          <h1 className="workbench-title">Projects</h1>
        </div>
        <form data-onboarding-id="create-project-form" onSubmit={createFromPage} className="env-create-inline">
          <input
            placeholder="New project name..."
            aria-label="New project name"
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

      <div className="workbench-toolbar">
        <div className="workbench-search">
          <Search size={15} />
          <input
            placeholder="Search projects..."
            aria-label="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="btn ghost env-sort-select"
          aria-label="Sort projects"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="updated_at">Recently updated</option>
          <option value="created_at">Recently created</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="project-index-grid">
        {activeProjects.map(renderCard)}

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
                {archivedProjects.map(renderCard)}
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
