import { ChevronLeft, Folder } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";

const projectTabs = [
  { path: "", label: "Tasks" },
  { path: "/files", label: "Files" },
  { path: "/context", label: "Context" },
  { path: "/canvases", label: "Canvases" },
  { path: "/settings", label: "Settings" }
];

export function ProjectNavigation() {
  const { activeWorkspaceId, activeEnvironmentId, environments } = useWorkspaceApp();
  const { pathname } = useLocation();
  const project = environments.find((item) => item.id === activeEnvironmentId);
  if (!project) return null;
  const base = `/app/${activeWorkspaceId}/projects/${project.id}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const suffix = pathname.slice(base.length).replace(/\/$/, "");
  const focused = suffix.startsWith("/tasks/") || suffix.startsWith("/canvases/");
  return (
    <header className={`project-navigation${focused ? " focused" : ""}`}>
      {focused ? (
        <Link to={base} className="project-breadcrumb" title={`Back to ${project.name}`}>
          <ChevronLeft size={15} /><span>{project.name}</span>
        </Link>
      ) : (
        <>
          <div className="project-navigation-identity"><Folder size={19} /><span>{project.name}</span></div>
          <nav className="project-tabs" aria-label="Project tools">
            {projectTabs.map((tab) => (
              <NavLink key={tab.path} to={`${base}${tab.path}`} end={tab.path === ""}
                className={({ isActive }) => `project-tab${isActive || (tab.path === "" && suffix === "/tasks") ? " active" : ""}`}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </header>
  );
}
