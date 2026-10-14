import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { preloadCodeHighlighter } from "./components/taskConversation/useHighlightedCode";
import { preloadMarkdownRehypePlugins } from "./components/taskConversation/useMarkdownRehypePlugins";

// Pages outside the main path (project landing, task, composer) load on demand, so the first load
// only downloads what it shows. Once the app is idle they, and the larger message renderers, are
// fetched in the background, so using one later does not wait on the network.
const loaders: Array<() => Promise<unknown>> = [];

function lazyPage<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K
): LazyExoticComponent<M[K]> {
  loaders.push(load);
  return lazy(async () => ({ default: (await load())[name] }));
}

export function preloadDeferredModules(): void {
  const run = () => {
    for (const load of loaders) void load().catch(() => undefined);
    void preloadMarkdownRehypePlugins().catch(() => undefined);
    void preloadCodeHighlighter().catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 4_000 });
  else window.setTimeout(run, 2_000);
}

export const EnvironmentIndexPage = lazyPage(() => import("./pages/environment/EnvironmentIndexPage"), "EnvironmentIndexPage");
export const EnvironmentSettingsPage = lazyPage(() => import("./pages/environment/EnvironmentSettingsPage"), "EnvironmentSettingsPage");
export const EnvironmentFilesPage = lazyPage(() => import("./pages/environment/EnvironmentFilesPage"), "EnvironmentFilesPage");
export const ProjectContextPage = lazyPage(() => import("./pages/environment/ProjectContextPage"), "ProjectContextPage");
export const ProjectCanvasPage = lazyPage(() => import("./pages/environment/ProjectCanvasPage"), "ProjectCanvasPage");
export const ProjectCanvasesPage = lazyPage(() => import("./pages/environment/ProjectCanvasesPage"), "ProjectCanvasesPage");
export const ProjectPersistentShellsPage = lazyPage(() => import("./pages/environment/ProjectPersistentShellsPage"), "ProjectPersistentShellsPage");
export const WorkspaceFilesPage = lazyPage(() => import("./pages/workspace/WorkspaceFilesPage"), "WorkspaceFilesPage");
export const WorkspaceMemoryPage = lazyPage(() => import("./pages/workspace/WorkspaceMemoryPage"), "WorkspaceMemoryPage");
export const WorkspaceGlobalSearchPage = lazyPage(() => import("./pages/workspace/WorkspaceGlobalSearchPage"), "WorkspaceGlobalSearchPage");
export const WorkspaceSettingsPage = lazyPage(() => import("./pages/workspace/WorkspaceSettingsPage"), "WorkspaceSettingsPage");
export const WorkspaceConnectorsPage = lazyPage(() => import("./pages/workspace/WorkspaceConnectorsPage"), "WorkspaceConnectorsPage");
export const WorkspaceNotificationsPage = lazyPage(() => import("./pages/workspace/WorkspaceNotificationsPage"), "WorkspaceNotificationsPage");
export const WorkspaceManagePage = lazyPage(() => import("./pages/workspace/WorkspaceManagePage"), "WorkspaceManagePage");
export const AdminSettingsPage = lazyPage(() => import("./pages/admin/AdminSettingsPage"), "AdminSettingsPage");
export const SubscriptionPage = lazyPage(() => import("./pages/user/SubscriptionPage"), "SubscriptionPage");
export const UserPreferencesPage = lazyPage(() => import("./pages/user/UserPreferencesPage"), "UserPreferencesPage");
export const ChangelogPage = lazyPage(() => import("./pages/public/ChangelogPage"), "ChangelogPage");
export const AnnouncementsPage = lazyPage(() => import("./pages/public/AnnouncementsPage"), "AnnouncementsPage");
export const PublicTaskPage = lazyPage(() => import("./pages/task/PublicTaskPage"), "PublicTaskPage");
export const ServerProfilesPage = lazyPage(() => import("./pages/desktop/ServerProfilesPage"), "ServerProfilesPage");
export const DesktopPreferencesPage = lazyPage(() => import("./pages/desktop/DesktopPreferencesPage"), "DesktopPreferencesPage");
export const QuickAgentPage = lazyPage(() => import("./pages/desktop/QuickAgentPage"), "QuickAgentPage");
