import { useState, useEffect, useCallback, useMemo } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { createApiClient } from "./lib/api";
import { readBrowserNotificationSettings } from "./lib/notificationSettings";
import { syncWebPushSubscription, unsubscribeWebPushSubscription } from "./lib/webPush";
import {
  DEFAULT_DESKTOP_SHORTCUT_PREFERENCES,
  sanitizeDesktopShortcutPreferences,
  type DesktopShortcutPreferences
} from "./desktop/desktopShortcuts";
import { syncThemeBranding } from "./lib/brand";
import { AppRuntimeContext } from "./contexts/AppRuntimeContext";
import { normalizeThemeMode, resolveTheme } from "./lib/theme";
import { readStoredTheme, themeAtBoot, THEME_KEY } from "./lib/theme-preference";
import { ThemeMode, FlashMessage } from "./lib/types";
import { AuthPage } from "./pages/auth/AuthPage";
import { AuthedHomeRedirect } from "./pages/home/AuthedHomeRedirect";
import { WorkspaceLayout } from "./pages/workspace/WorkspaceLayout";
import { EnvironmentIndexPage } from "./pages/environment/EnvironmentIndexPage";
import { EnvironmentOverviewPage } from "./pages/environment/EnvironmentOverviewPage";
import { ProjectEntryPage } from "./pages/environment/ProjectEntryPage";
import { EnvironmentSettingsPage } from "./pages/environment/EnvironmentSettingsPage";
import { EnvironmentFilesPage } from "./pages/environment/EnvironmentFilesPage";
import { ProjectContextPage } from "./pages/environment/ProjectContextPage";
import { ProjectCanvasPage } from "./pages/environment/ProjectCanvasPage";
import { ProjectCanvasesPage } from "./pages/environment/ProjectCanvasesPage";
import { ProjectPersistentShellsPage } from "./pages/environment/ProjectPersistentShellsPage";
import { WorkspaceFilesPage } from "./pages/workspace/WorkspaceFilesPage";
import { WorkspaceMemoryPage } from "./pages/workspace/WorkspaceMemoryPage";
import { WorkspaceGlobalSearchPage } from "./pages/workspace/WorkspaceGlobalSearchPage";
import { WorkspaceSettingsPage } from "./pages/workspace/WorkspaceSettingsPage";
import { TaskComposerPage } from "./pages/task/TaskComposerPage";
import { TaskDetailPage } from "./pages/task/TaskDetailPage";
import { WorkspaceConnectorsPage } from "./pages/workspace/WorkspaceConnectorsPage";
import { AdminSettingsPage } from "./pages/admin/AdminSettingsPage";
import { WorkspaceManagePage } from "./pages/workspace/WorkspaceManagePage";
import { ChangelogPage } from "./pages/public/ChangelogPage";
import { AnnouncementsPage } from "./pages/public/AnnouncementsPage";
import { WorkspaceNotificationsPage } from "./pages/workspace/WorkspaceNotificationsPage";
import { SubscriptionPage } from "./pages/user/SubscriptionPage";
import { UserPreferencesPage } from "./pages/user/UserPreferencesPage";
import { PublicTaskPage } from "./pages/task/PublicTaskPage";
import { ServerProfilesPage } from "./pages/desktop/ServerProfilesPage";
import { DesktopPreferencesPage } from "./pages/desktop/DesktopPreferencesPage";
import { QuickAgentPage } from "./pages/desktop/QuickAgentPage";
import { DesktopComputerExecutorBridge } from "./components/desktop/DesktopComputerExecutorBridge";
import { LoadingScreen } from "./components/LoadingScreen";
import {
  platform,
  fetchPublicServerConfig,
  resolveActiveServerProfile,
  sanitizeDesktopActiveContext,
  type DesktopActiveContext,
  type ServerProfilesState
} from "./desktop/platform";
import { defaultApiBaseUrl, setRuntimeApiBaseUrl } from "./lib/runtime";
import { invalidateApiCache } from "./lib/api-cache";



function DesktopNavigateListener() {
  const navigate = useNavigate();

  useEffect(() => platform.onNavigateRequested((route) => navigate(route)), [navigate]);
  return null;
}

function LegacyEnvironmentRouteRedirect() {
  const location = useLocation();

  return (
    <Navigate
      replace
      to={{
        pathname: location.pathname.replace("/environments", "/projects"),
        search: location.search,
        hash: location.hash
      }}
    />
  );
}

export function App() {
  const location = useLocation();
  const [hasStoredThemeAtBoot] = useState<boolean>(() => readStoredTheme() !== undefined);
  const [token, setToken] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(themeAtBoot);
  const [hasLoadedUserThemePreference, setHasLoadedUserThemePreference] = useState(false);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [isRuntimeBootstrapping, setIsRuntimeBootstrapping] = useState(true);
  const [serverProfilesState, setServerProfilesState] = useState<ServerProfilesState>({
    profiles: [],
    activeProfileId: null
  });
  const [shortcutPreferences, setShortcutPreferences] = useState<DesktopShortcutPreferences>({
    ...DEFAULT_DESKTOP_SHORTCUT_PREFERENCES
  });
  const [activeContext, setActiveContext] = useState<DesktopActiveContext>({
    workspaceId: null,
    environmentId: null
  });
  const [publicServerConfig, setPublicServerConfig] = useState<{ docsUrl?: string | null; publicUrl?: string | null; appUrl?: string | null } | null>(null);

  const activeServerProfile = useMemo(() => resolveActiveServerProfile(serverProfilesState), [serverProfilesState]);
  const requiresServerSelection = platform.capabilities.supportsServerProfiles && activeServerProfile === null;
  const enableDesktopComputerExecutor = !requiresServerSelection && location.pathname !== "/desktop/quick-agent";

  const refreshPublicServerConfig = useCallback(async (): Promise<void> => {
    if (!activeServerProfile) {
      setPublicServerConfig(null);
      return;
    }

    const nextConfig = await fetchPublicServerConfig(activeServerProfile.baseUrl);
    setPublicServerConfig(nextConfig);
  }, [activeServerProfile]);

  const saveServerProfilesState = useCallback(async (nextState: ServerProfilesState): Promise<void> => {
    const saved = await platform.saveServerProfilesState(nextState);
    const nextActiveProfile = resolveActiveServerProfile(saved);
    setRuntimeApiBaseUrl(nextActiveProfile?.baseUrl ?? defaultApiBaseUrl());
    setServerProfilesState(saved);
  }, []);

  const saveShortcutPreferences = useCallback(async (nextState: DesktopShortcutPreferences): Promise<void> => {
    const saved = await platform.saveShortcutPreferences(nextState);
    setShortcutPreferences(saved);
  }, []);

  const saveActiveContext = useCallback(async (nextState: DesktopActiveContext): Promise<void> => {
    const saved = await platform.saveActiveContext(nextState);
    setActiveContext(saved);
  }, []);

  const persistAuthToken = useCallback(async (nextToken: string | null): Promise<void> => {
    await platform.saveAuthToken(nextToken);
    if (nextToken !== token) {
      invalidateApiCache();
    }
    setToken(nextToken);
  }, [token]);

  useEffect(() => {
    if (!token || !activeServerProfile || platform.capabilities.isDesktop) {
      return;
    }

    const settings = readBrowserNotificationSettings();
    void syncWebPushSubscription(
      createApiClient(token),
      settings.enablePushNotifications,
      settings.notifyOnBackgroundResponses
    );
  }, [activeServerProfile, platform.capabilities.isDesktop, token]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapRuntime(): Promise<void> {
      setIsRuntimeBootstrapping(true);
      try {
        const bootstrapData = await platform.getBootstrapData();
        if (cancelled) {
          return;
        }

        const bootstrapActiveProfile = resolveActiveServerProfile(bootstrapData.serverProfilesState);
        setRuntimeApiBaseUrl(bootstrapActiveProfile?.baseUrl ?? defaultApiBaseUrl());
        setToken(bootstrapData.token);
        setServerProfilesState(bootstrapData.serverProfilesState);
        setShortcutPreferences(sanitizeDesktopShortcutPreferences(bootstrapData.shortcutPreferences));
        setActiveContext(sanitizeDesktopActiveContext(bootstrapData.activeContext));
        setHasLoadedUserThemePreference(bootstrapData.token === null);
      } finally {
        if (!cancelled) {
          setIsRuntimeBootstrapping(false);
        }
      }
    }

    void bootstrapRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRuntimeApiBaseUrl(activeServerProfile?.baseUrl ?? defaultApiBaseUrl());
  }, [activeServerProfile?.baseUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadPublicConfig(): Promise<void> {
      if (!activeServerProfile) {
        setPublicServerConfig(null);
        return;
      }

      const nextConfig = await fetchPublicServerConfig(activeServerProfile.baseUrl);
      if (!cancelled) {
        setPublicServerConfig(nextConfig);
      }
    }

    void loadPublicConfig();
    return () => {
      cancelled = true;
    };
  }, [activeServerProfile?.baseUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, themeMode);
    } catch {
      // The in-memory preference still works when browser storage is unavailable.
    }
    const appliedTheme = resolveTheme(themeMode);
    document.documentElement.setAttribute("data-theme", appliedTheme);
    syncThemeBranding();
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.setAttribute("data-theme", resolveTheme("system"));
      syncThemeBranding();
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [themeMode]);

  useEffect(() => {
    if (!token || !activeServerProfile) {
      setHasLoadedUserThemePreference(true);
      return;
    }

    setHasLoadedUserThemePreference(false);
    let cancelled = false;
    const api = createApiClient(token);
    void api
      .get<{ user: { theme_preference?: string | null } }>("/api/auth/me")
      .then((response) => {
        if (cancelled) {
          return;
        }

        const preference = normalizeThemeMode(response.user.theme_preference);
        if (!hasStoredThemeAtBoot && preference !== undefined) {
          setThemeMode(preference);
        }
      })
      .catch(() => {
        // Keep local fallback when theme preference fetch fails.
      })
      .finally(() => {
        if (!cancelled) {
          setHasLoadedUserThemePreference(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, hasStoredThemeAtBoot, activeServerProfile?.baseUrl]);

  useEffect(() => {
    if (!token || !hasLoadedUserThemePreference || !activeServerProfile) {
      return;
    }

    const api = createApiClient(token);
    void api.patch("/api/auth/preferences", { themePreference: themeMode }).catch(() => {
      // Ignore transient failures; local preference is still preserved.
    });
  }, [token, themeMode, hasLoadedUserThemePreference, activeServerProfile?.baseUrl]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(timer);
  }, [flash]);

  const handleLogout = useCallback((): void => {
    setHasLoadedUserThemePreference(true);
    if (token && !platform.capabilities.isDesktop) {
      void unsubscribeWebPushSubscription(createApiClient(token));
    }
    void persistAuthToken(null);
  }, [persistAuthToken, platform.capabilities.isDesktop, token]);

  const handleToken = useCallback((nextToken: string): void => {
    setHasLoadedUserThemePreference(false);
    void persistAuthToken(nextToken);
  }, [persistAuthToken]);

  const runtimeContextValue = useMemo(() => ({
    platform,
    capabilities: platform.capabilities,
    serverProfilesState,
    activeServerProfile,
    saveServerProfilesState,
    shortcutPreferences,
    saveShortcutPreferences,
    activeContext,
    saveActiveContext,
    publicServerConfig,
    refreshPublicServerConfig
  }), [serverProfilesState, activeServerProfile, saveServerProfilesState, shortcutPreferences, saveShortcutPreferences, activeContext, saveActiveContext, publicServerConfig, refreshPublicServerConfig]);

  if (isRuntimeBootstrapping) {
    return <LoadingScreen label="Loading Meowbert..." />;
  }

  const guard = (element: JSX.Element): JSX.Element => (requiresServerSelection ? <Navigate to="/servers" replace /> : element);

  return (
    <AppRuntimeContext.Provider value={runtimeContextValue}>
      <DesktopNavigateListener />
      <DesktopComputerExecutorBridge
        token={token}
        enabled={enableDesktopComputerExecutor}
        platform={platform}
      />
      <div className="page-root">
        {flash ? (
          <div className={`toast ${flash.tone}`}>
            <span>{flash.text}</span>
            <button type="button" className="icon-btn" onClick={() => setFlash(null)} aria-label="Dismiss message">
              ×
            </button>
          </div>
        ) : null}

        <Routes>
          <Route path="/servers" element={<ServerProfilesPage />} />
          <Route path="/desktop/preferences" element={<DesktopPreferencesPage />} />
          <Route path="/desktop/quick-agent" element={<QuickAgentPage token={token} requiresServerSelection={requiresServerSelection} />} />
          <Route path="/changelog" element={guard(<ChangelogPage themeMode={themeMode} setThemeMode={setThemeMode} />)} />
          <Route path="/announcements" element={guard(<AnnouncementsPage themeMode={themeMode} setThemeMode={setThemeMode} />)} />
          <Route path="/share/tasks/:shareId" element={guard(<PublicTaskPage token={token} />)} />
          <Route
            path="/"
            element={guard(
              token ? (
                <AuthedHomeRedirect token={token} onTokenInvalid={handleLogout} />
              ) : (
                <Navigate to="/auth" replace />
              )
            )}
          />
          <Route
            path="/auth"
            element={guard(
              token ? (
                <AuthedHomeRedirect token={token} onTokenInvalid={handleLogout} />
              ) : (
                <AuthPage
                  onToken={handleToken}
                  setFlash={setFlash}
                />
              )
            )}
          />
          <Route
            path="/app"
            element={guard(token ? <AuthedHomeRedirect token={token} onTokenInvalid={handleLogout} /> : <Navigate to="/auth" replace />)}
          />
          <Route
            path="/app/:workspaceId/*"
            element={guard(
              token ? (
                <WorkspaceLayout
                  token={token}
                  onLogout={handleLogout}
                  onReplaceSessionToken={handleToken}
                  themeMode={themeMode}
                  setThemeMode={setThemeMode}
                  setFlash={setFlash}
                />
              ) : (
                <Navigate to="/auth" replace />
              )
            )}
          >
            <Route index element={<Navigate to="projects" replace />} />
            <Route path="projects" element={<EnvironmentIndexPage />} />
            <Route path="environments/*" element={<LegacyEnvironmentRouteRedirect />} />
            <Route path="search" element={<WorkspaceGlobalSearchPage />} />
            <Route path="files" element={<WorkspaceFilesPage />} />
            <Route path="memory" element={<WorkspaceMemoryPage />} />
            <Route path="settings" element={<WorkspaceSettingsPage />} />
            <Route path="preferences" element={<UserPreferencesPage />} />
            <Route path="notifications" element={<WorkspaceNotificationsPage />} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="connectors" element={<WorkspaceConnectorsPage />} />
            <Route path="admin" element={<AdminSettingsPage />} />
            <Route path="manage" element={<WorkspaceManagePage token={token ?? ""} setFlash={setFlash} />} />
            <Route path="projects/:projectId" element={<ProjectEntryPage />} />
            <Route path="projects/:projectId/tasks" element={<EnvironmentOverviewPage />} />
            <Route path="projects/:projectId/overview" element={<Navigate to=".." relative="path" replace />} />
            <Route path="projects/:projectId/settings" element={<EnvironmentSettingsPage />} />
            <Route path="projects/:projectId/files" element={<EnvironmentFilesPage />} />
            <Route path="projects/:projectId/context" element={<ProjectContextPage />} />
            <Route path="projects/:projectId/canvases" element={<ProjectCanvasesPage />} />
            <Route path="projects/:projectId/canvases/:canvasId" element={<ProjectCanvasPage />} />
            <Route path="projects/:projectId/shells" element={<ProjectPersistentShellsPage />} />
            <Route path="projects/:projectId/tasks/new" element={<TaskComposerPage />} />
            <Route path="projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
            <Route path="projects/:projectId/shell" element={<Navigate to=".." relative="path" replace />} />
          </Route>
          <Route path="*" element={<Navigate to={requiresServerSelection ? "/servers" : token ? "/app" : "/"} replace />} />
        </Routes>
      </div>
    </AppRuntimeContext.Provider>
  );
}
