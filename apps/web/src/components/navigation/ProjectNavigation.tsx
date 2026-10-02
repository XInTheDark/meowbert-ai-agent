import { ChevronLeft, Folder } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { getProjectMasterEnabled } from "@meowbert/shared/workspace-agent-settings";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";

const projectTabs = [
  { path: "", label: "Tasks" },
  { path: "/files", label: "Files" },
  { path: "/context", label: "Context" },
  { path: "/canvases", label: "Canvases" },
  { path: "/settings", label: "Settings" }
];

export function ProjectNavigation() {
  const { activeWorkspaceId, activeEnvironmentId, environments, workspaceSettings } = useWorkspaceApp();
  const { pathname } = useLocation();
  const project = environments.find((item) => item.id === activeEnvironmentId);
  if (!project) return null;
  const base = `/app/${activeWorkspaceId}/projects/${project.id}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const suffix = pathname.slice(base.length).replace(/\/$/, "");
  const focused = suffix.startsWith("/tasks/") || suffix.startsWith("/canvases/");
  // With the Master on, the project root is its conversation, so Tasks points at the full list instead.
  const tasksPath = getProjectMasterEnabled(workspaceSettings?.modelDefaults) ? "/tasks" : "";
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
            {projectTabs.map((tab) => {
              const path = tab.path === "" ? tasksPath : tab.path;
              return (
                <NavLink key={tab.label} to={`${base}${path}`} end={path === ""}
                  className={({ isActive }) => `project-tab${isActive || (path === "" && suffix === "/tasks") ? " active" : ""}`}>
                  {tab.label}
                </NavLink>
              );
            })}
          </nav>
        </>
      )}
    </header>
  );
}
