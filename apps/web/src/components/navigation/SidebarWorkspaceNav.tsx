import { Fragment } from "react";
import { Folder } from "lucide-react";
import { NavLink } from "react-router-dom";
import { SidebarNavItem, type NavItem } from "./SidebarNavItem";
import type { Environment } from "../../lib/types";

interface SidebarWorkspaceNavProps {
  workspaceNavItems: NavItem[];
  recentEnvironments: Environment[];
  activeWorkspaceId: string | null;
  isRail: boolean;
  workspaceSettingsExpanded: boolean;
  prefetchProject: (projectId: string) => void;
  onMobileClose: () => void;
}

export function SidebarWorkspaceNav(props: SidebarWorkspaceNavProps) {
  const { workspaceNavItems, recentEnvironments, activeWorkspaceId, isRail, onMobileClose } = props;
  return (
    <div className="sidebar-navigation">
      <nav className="sidebar-nav" aria-label="Workspace">
        {workspaceNavItems.slice(0, 3).map((item) => (
          <SidebarNavItem key={item.to} item={item} collapsed={isRail} onNavigate={onMobileClose} />
        ))}
      </nav>
      {!isRail && recentEnvironments.length > 0 ? (
        <nav className="sidebar-nav sidebar-projects" aria-label="Projects">
          <div className="sidebar-section-label">Projects</div>
          {recentEnvironments.map((project) => (
            <SidebarNavItem key={project.id} item={{
              to: `/app/${activeWorkspaceId}/projects/${project.id}`,
              icon: Folder, label: project.name,
              extraClassName: "project-link",
              onPrefetch: () => props.prefetchProject(project.id)
            }} collapsed={false} onNavigate={onMobileClose} />
          ))}
        </nav>
      ) : null}
      <nav className="sidebar-nav sidebar-management" aria-label="Workspace management">
        {workspaceNavItems.slice(3).map((item) => (
          <Fragment key={item.to}>
            <SidebarNavItem item={item} collapsed={isRail} onNavigate={onMobileClose} />
            {item.to === `/app/${activeWorkspaceId}/settings` ? (
              props.workspaceSettingsExpanded && !isRail ? (
                <>
                  <NavLink to={`/app/${activeWorkspaceId}/memory`}
                    className={({ isActive }) => `nav-link nested-link ${isActive ? "active" : ""}`} onClick={onMobileClose}>
                    <span>Memory</span>
                  </NavLink>
                  <NavLink to={`/app/${activeWorkspaceId}/connectors`}
                    className={({ isActive }) => `nav-link nested-link ${isActive ? "active" : ""}`} onClick={onMobileClose}>
                    <span>Connectors</span>
                  </NavLink>
                </>
              ) : null
            ) : null}
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
