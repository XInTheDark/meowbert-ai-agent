import { ProjectNavigation } from "../../components/navigation/ProjectNavigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useVisualViewportMetrics } from "../../hooks/useVisualViewportMetrics";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Sidebar } from "../../components/navigation/Sidebar";
import { CommandPalette } from "../../components/navigation/CommandPalette";
import {
  isMobileBottomNavigationVisible,
  MobileBottomNavigation
} from "../../components/navigation/MobileBottomNavigation";
import { WorkspaceContext } from "../../contexts/WorkspaceContext";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { OnboardingManager } from "../../onboarding/OnboardingManager";
import { AdminSetupWizard } from "../../onboarding/admin/AdminSetupWizard";
import { useAdminSetupStatus } from "../../onboarding/admin/useAdminSetupStatus";
import { useDocumentTitle } from "../../lib/documentTitle";
import { type FlashMessage, type ThemeMode, type WorkspaceContextValue } from "../../lib/types";
import { buildWorkspaceCommandPaletteActions } from "./layout/commandPaletteActions";
import { useWorkspaceDesktopShortcuts } from "./layout/useWorkspaceDesktopShortcuts";
import { useWorkspaceLayoutController } from "./layout/useWorkspaceLayoutController";
import { useWorkspaceNotificationStream } from "./layout/useWorkspaceNotificationStream";
import { LoadingScreen } from "../../components/LoadingScreen";

function buildWorkspaceRouteTitleParts(input: {
  pathname: string;
  workspaceName: string | null;
  projectName: string | null;
}): string[] {
  const segments = input.pathname.split("/").filter((segment) => segment.length > 0);
  const workspaceName = input.workspaceName ?? "Workspace";
  const projectName = input.projectName ?? "Project";
  const section = segments[2] ?? null;
  const projectSection = segments[4] ?? null;
  const projectTaskSegment = segments[5] ?? null;

  if (section === "projects" && !segments[3]) {
    return ["Projects", workspaceName];
  }

  if (section === "files") {
    return ["Files", workspaceName];
  }

  if (section === "memory") {
    return ["Memory", workspaceName];
  }

  if (section === "search") {
    return ["Search", workspaceName];
  }

  if (section === "settings") {
    return ["Workspace Settings", workspaceName];
  }

  if (section === "preferences") {
    return ["Preferences", workspaceName];
  }

  if (section === "notifications") {
    return ["Notifications", workspaceName];
  }

  if (section === "subscription") {
    return ["Subscription", workspaceName];
  }

  if (section === "connectors") {
    return ["Connectors", workspaceName];
  }

  if (section === "admin") {
    return ["Admin", workspaceName];
  }

  if (section === "manage") {
    return ["Workspaces", workspaceName];
  }

  if (section !== "projects" || !segments[3]) {
    return [workspaceName];
  }

  if (!projectSection || projectSection === "overview") {
    return [projectName];
  }

  if (projectSection === "settings") {
    return ["Settings", projectName];
  }

  if (projectSection === "files") {
    return ["Files", projectName];
  }

  if (projectSection === "context") {
    return ["Context", projectName];
  }

  if (projectSection === "canvases") {
    return ["Canvases", projectName];
  }

  if (projectSection === "shells") {
    return ["Background shells", projectName];
  }

  if (projectSection === "tasks" && projectTaskSegment === "new") {
    return ["New Task", projectName];
  }

  if (projectSection === "tasks" && projectTaskSegment) {
    return ["Task", projectName];
  }

  return [projectName];
}

export function WorkspaceLayout(props: {
  token: string;
  onLogout: () => void;
  onReplaceSessionToken: (token: string) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  setFlash: (flash: FlashMessage | null) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ workspaceId: string; projectId?: string; envId?: string }>();
  const { platform, capabilities, activeServerProfile, shortcutPreferences, saveActiveContext } = useAppRuntime();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  useVisualViewportMetrics();

  const activeWorkspaceId = params.workspaceId ?? "";
  const activeProjectId = params.projectId ?? params.envId ?? null;
  const controller = useWorkspaceLayoutController({
    token: props.token,
    activeWorkspaceId,
    activeEnvironmentId: activeProjectId,
    navigate,
    pathname: location.pathname,
    onLogout: props.onLogout,
    onReplaceSessionToken: props.onReplaceSessionToken,
    setFlash: props.setFlash
  });
  const adminSetup = useAdminSetupStatus(controller.api, controller.user);
  const routeTitleParts = useMemo(() => buildWorkspaceRouteTitleParts({
    pathname: location.pathname,
    workspaceName: controller.activeWorkspace?.name ?? null,
    projectName: controller.activeEnvironment?.name ?? null
  }), [controller.activeEnvironment?.name, controller.activeWorkspace?.name, location.pathname]);
  const isTaskDetailRoute = useMemo(() => {
    const segments = location.pathname.split("/").filter((segment) => segment.length > 0);
    return segments[2] === "projects" && segments[4] === "tasks" && Boolean(segments[5]) && segments[5] !== "new";
  }, [location.pathname]);
  const hasMobileBottomNavigation = isMobileBottomNavigationVisible(location.pathname);

  useDocumentTitle(...routeTitleParts);

  const handleRevealCurrentFolder = useCallback(async (): Promise<void> => {
    if (!capabilities.supportsRevealPath || activeServerProfile?.mode !== "local") {
      props.setFlash({ tone: "error", text: "Reveal folder is available only in local desktop mode." });
      return;
    }

    const rootPath = controller.activeEnvironment?.root_path;
    if (!rootPath) {
      props.setFlash({ tone: "error", text: "Project path is not available yet." });
      return;
    }

    const result = await platform.revealPath({ absolutePath: rootPath });
    if (!result.ok) {
      props.setFlash({ tone: "error", text: result.error ?? "Unable to reveal folder." });
    }
  }, [activeServerProfile?.mode, capabilities.supportsRevealPath, controller.activeEnvironment?.root_path, platform, props]);

  useWorkspaceNotificationStream({
    activeWorkspaceId,
    api: controller.api,
    isDesktop: capabilities.isDesktop,
    platform,
    token: props.token
  });

  useWorkspaceDesktopShortcuts({
    activeWorkspaceId,
    activeEnvironmentId: activeProjectId,
    navigate,
    onOpenCommandPalette: () => setIsCommandPaletteOpen(true),
    onRevealCurrentFolder: handleRevealCurrentFolder,
    shortcutPreferences
  });

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!capabilities.isDesktop) {
      return;
    }

    void saveActiveContext({
      workspaceId: activeWorkspaceId || null,
      environmentId: activeProjectId
    });
  }, [activeProjectId, activeWorkspaceId, capabilities.isDesktop, saveActiveContext]);

  const commandPaletteActions = useMemo(
    () => buildWorkspaceCommandPaletteActions({
      activeWorkspaceId,
      activeProjectId,
      activeWorkspace: controller.activeWorkspace,
      activeProject: controller.activeEnvironment,
      tasks: controller.tasks,
      userIsSuperAdmin: controller.user?.is_super_admin === true,
      isDesktop: capabilities.isDesktop,
      supportsRevealPath: capabilities.supportsRevealPath,
      supportsServerProfiles: capabilities.supportsServerProfiles,
      activeServerProfile,
      navigate,
      onRevealCurrentFolder: handleRevealCurrentFolder,
      platform
    }),
    [
      activeProjectId,
      activeServerProfile,
      activeWorkspaceId,
      capabilities.isDesktop,
      capabilities.supportsRevealPath,
      capabilities.supportsServerProfiles,
      controller.activeEnvironment,
      controller.activeWorkspace,
      controller.tasks,
      controller.user?.is_super_admin,
      handleRevealCurrentFolder,
      navigate,
      platform
    ]
  );

  const contextValue: WorkspaceContextValue = {
    api: controller.api,
    token: props.token,
    user: controller.user,
    workspaces: controller.workspaces,
    projects: controller.environments,
    environments: controller.environments,
    tasks: controller.tasks,
    workspaceSettings: controller.workspaceSettings,
    isWorkspaceSettingsLoading: controller.isWorkspaceSettingsLoading,
    activeWorkspaceId,
    activeProjectId: activeProjectId,
    activeEnvironmentId: activeProjectId,
    isBootstrapping: controller.isBootstrapping,
    isEnvironmentsLoading: controller.isEnvironmentsLoading,
    isTasksLoading: controller.isTasksLoading,
    setFlash: props.setFlash,
    refreshWorkspaces: controller.refreshWorkspaces,
    refreshProjects: controller.refreshEnvironments,
    refreshEnvironments: controller.refreshEnvironments,
    refreshTasks: controller.refreshTasks,
    refreshWorkspaceSettings: controller.refreshWorkspaceSettings,
    createWorkspace: controller.createWorkspace,
    createProject: controller.createEnvironment,
    createEnvironment: controller.createEnvironment,
    patchProject: controller.patchEnvironment,
    patchEnvironment: controller.patchEnvironment,
    openMobileNavigation: () => setIsMobileNavOpen(true),
    replaceSessionToken: controller.replaceSessionToken
  };

  if (controller.isBootstrapping) {
    return <LoadingScreen label="Loading workspace navigation..." />;
  }

  const adminSetupActive = adminSetup.needsSetup || adminSetup.isChecking;

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <OnboardingManager
        api={controller.api}
        user={controller.user}
        activeWorkspaceId={activeWorkspaceId}
        activeEnvironmentId={activeProjectId}
        environments={controller.environments}
        setFlash={props.setFlash}
        deferAutoStart={adminSetupActive}
      >
        <main className="product-shell">
          <Sidebar
            themeMode={props.themeMode}
            setThemeMode={props.setThemeMode}
            onLogout={props.onLogout}
            mobileOpen={isMobileNavOpen}
            onMobileClose={() => setIsMobileNavOpen(false)}
          />
          <button
            type="button"
            className={`sidebar-backdrop ${isMobileNavOpen ? "visible" : ""}`}
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close navigation"
          />
          <div className={`main-column${isTaskDetailRoute ? " task-detail-route" : ""}${hasMobileBottomNavigation ? " has-mobile-bottom-nav" : ""}`}>
            <div className="mobile-shell-header">
              <button
                type="button"
                className="btn ghost mobile-nav-toggle"
                onClick={() => setIsMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                ☰
              </button>
              <div className="mobile-shell-title">
                <strong>{controller.activeWorkspace?.name ?? "Workspace"}</strong>
                {controller.activeEnvironment ? <span>{controller.activeEnvironment.name}</span> : null}
              </div>
            </div>
            {controller.navError && <div className="error-banner">{controller.navError}</div>}
            <ProjectNavigation />
            <Outlet />
            <MobileBottomNavigation
              pathname={location.pathname}
              workspaceId={activeWorkspaceId}
              projectId={activeProjectId}
              onOpenMore={() => setIsMobileNavOpen(true)}
              onNewTaskWithoutProject={() => {
                props.setFlash({ tone: "error", text: "Choose a project before starting a task." });
                navigate(`/app/${activeWorkspaceId}/projects`);
              }}
            />
          </div>
          <CommandPalette
            open={isCommandPaletteOpen}
            actions={commandPaletteActions}
            onClose={() => setIsCommandPaletteOpen(false)}
          />
        </main>
        {adminSetup.needsSetup ? (
          <AdminSetupWizard
            api={controller.api}
            onSkip={adminSetup.dismiss}
            onComplete={adminSetup.complete}
            onOpenAdmin={() => {
              adminSetup.complete();
              navigate(`/app/${activeWorkspaceId}/admin`);
            }}
          />
        ) : null}
      </OnboardingManager>
    </WorkspaceContext.Provider>
  );
}
