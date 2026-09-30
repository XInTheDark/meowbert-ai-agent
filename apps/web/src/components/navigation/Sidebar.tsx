import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import type { ThemeMode } from "../../lib/types";
import { WorkspaceSwitcher } from "../workspaceSwitcher/WorkspaceSwitcher";
import { saveLastWorkspaceId } from "../../pages/workspace/layout/utils";
import { SidebarBrandHeader } from "./SidebarBrandHeader";
import { SidebarNewTask } from "./SidebarNewTask";
import { SidebarWorkspaceNav } from "./SidebarWorkspaceNav";
import { SidebarFooter } from "./SidebarFooter";
import { useSidebarNavigation } from "./useSidebarNavigation";

interface SidebarProps {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ themeMode, setThemeMode, onLogout, mobileOpen, onMobileClose }: SidebarProps) {
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const {
    workspaces,
    environments,
    activeWorkspaceId,
    activeEnvironmentId
  } = useWorkspaceApp();

  const { recentEnvironments, workspaceSettingsExpanded, prefetchProject, workspaceNavItems } = useSidebarNavigation();
  const isRail = isCollapsed && !mobileOpen;

  useEffect(() => {
    if (mobileOpen) {
      setIsCollapsed(false);
    }
  }, [mobileOpen]);


  return (
    <>
      <aside className={`sidebar ${isRail ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`.trim()}>
        <SidebarBrandHeader isRail={isRail} onCollapse={() => setIsCollapsed(true)} />

        {isRail ? null : (
          <div className="sidebar-workspace-switcher">
            <WorkspaceSwitcher
              activeWorkspaceId={activeWorkspaceId}
              workspaces={workspaces}
              onSelectWorkspace={(workspaceId) => {
                saveLastWorkspaceId(workspaceId);
                navigate(`/app/${workspaceId}/projects`);
                onMobileClose();
              }}
              onCreateWorkspace={() => {
                navigate(`/app/${activeWorkspaceId}/manage?create=1`);
                onMobileClose();
              }}
              onManageWorkspaces={() => {
                navigate(`/app/${activeWorkspaceId}/manage`);
                onMobileClose();
              }}
            />
          </div>
        )}

        <SidebarNewTask projectId={activeEnvironmentId} workspaceId={activeWorkspaceId} projects={environments}
          isRail={isRail} onNavigate={onMobileClose} />

        <SidebarWorkspaceNav
          workspaceNavItems={workspaceNavItems}
          recentEnvironments={recentEnvironments}
          activeWorkspaceId={activeWorkspaceId}
          isRail={isRail}
          workspaceSettingsExpanded={workspaceSettingsExpanded}
          prefetchProject={prefetchProject}
          onMobileClose={onMobileClose}
        />

        <SidebarFooter themeMode={themeMode} setThemeMode={setThemeMode} onLogout={onLogout}
          isRail={isRail} onExpand={() => setIsCollapsed(false)} onMobileClose={onMobileClose} />
      </aside>
    </>
  );
}
