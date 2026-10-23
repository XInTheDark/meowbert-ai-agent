import { PanelLeft } from "lucide-react";
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
import { useSidebarVisibility } from "./useSidebarVisibility";

interface SidebarProps {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ themeMode, setThemeMode, onLogout, mobileOpen, onMobileClose }: SidebarProps) {
  const navigate = useNavigate();
  const { pinned, peeking, startPeek, endPeek, setPinned } = useSidebarVisibility();
  const {
    workspaces,
    environments,
    activeWorkspaceId,
    activeEnvironmentId
  } = useWorkspaceApp();

  const { recentEnvironments, workspaceSettingsExpanded, prefetchProject, workspaceNavItems } = useSidebarNavigation();
  const sidebarClassName = ["sidebar", pinned ? "" : "floating", peeking ? "peek" : "", mobileOpen ? "mobile-open" : ""]
    .filter(Boolean).join(" ");

  return (
    <>
      {pinned ? null : (
        <button
          className="btn ghost icon-btn sidebar-reveal-btn"
          type="button"
          onClick={() => setPinned(true)}
          onMouseEnter={startPeek}
          onMouseLeave={endPeek}
          title="Show Sidebar"
          aria-label="Show Sidebar"
        >
          <PanelLeft size={18} />
        </button>
      )}
      <aside className={sidebarClassName} onMouseEnter={pinned ? undefined : startPeek} onMouseLeave={pinned ? undefined : endPeek}>
        <SidebarBrandHeader onHide={() => setPinned(false)} />

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

        <SidebarNewTask projectId={activeEnvironmentId} workspaceId={activeWorkspaceId} projects={environments}
          onNavigate={onMobileClose} />

        <SidebarWorkspaceNav
          workspaceNavItems={workspaceNavItems}
          recentEnvironments={recentEnvironments}
          activeWorkspaceId={activeWorkspaceId}
          workspaceSettingsExpanded={workspaceSettingsExpanded}
          prefetchProject={prefetchProject}
          onMobileClose={onMobileClose}
        />

        <SidebarFooter themeMode={themeMode} setThemeMode={setThemeMode} onLogout={onLogout}
          onMobileClose={onMobileClose} />
      </aside>
    </>
  );
}
