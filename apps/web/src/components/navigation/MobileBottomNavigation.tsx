import { Bell, FolderKanban, Menu, Plus, Search } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";

export function isMobileBottomNavigationVisible(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const section = segments[2] ?? "projects";
  const projectSection = segments[4] ?? null;
  const detailSegment = segments[5] ?? null;

  if (section !== "projects") return true;
  if (projectSection === "shell") return false;
  return projectSection !== "canvases" || detailSegment === null;
}

export function MobileBottomNavigation(props: {
  pathname: string;
  workspaceId: string;
  projectId: string | null;
  onOpenMore: () => void;
  onNewTaskWithoutProject: () => void;
}) {
  const navigate = useNavigate();
  if (!isMobileBottomNavigationVisible(props.pathname)) return null;

  const root = `/app/${props.workspaceId}`;
  const section = props.pathname.split("/").filter(Boolean)[2] ?? "projects";
  const newTaskPath = props.projectId ? `${root}/projects/${props.projectId}/tasks/new` : null;
  const projectsActive = section === "projects";
  const moreActive = !["projects", "search", "notifications"].includes(section);

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      <NavLink to={`${root}/projects`} className={projectsActive ? "active" : ""}>
        <FolderKanban size={20} /><span>Projects</span>
      </NavLink>
      <NavLink to={`${root}/search`} className={section === "search" ? "active" : ""}>
        <Search size={20} /><span>Search</span>
      </NavLink>
      <button
        type="button"
        className="mobile-bottom-nav-create"
        onClick={() => newTaskPath ? navigate(newTaskPath) : props.onNewTaskWithoutProject()}
        aria-label="New Task"
      >
        <span className="mobile-bottom-nav-create-icon"><Plus size={22} /></span><span>New Task</span>
      </button>
      <NavLink to={`${root}/notifications`} className={section === "notifications" ? "active" : ""}>
        <Bell size={20} /><span>Updates</span>
      </NavLink>
      <button type="button" className={moreActive ? "active" : ""} onClick={props.onOpenMore}>
        <Menu size={20} /><span>More</span>
      </button>
    </nav>
  );
}
