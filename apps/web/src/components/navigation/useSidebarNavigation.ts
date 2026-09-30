import { useLocation } from "react-router-dom";
import { Bell, LayoutGrid, Search, Settings, Shield, Wallet } from "lucide-react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { API_CACHE_TTLS } from "../../lib/api-cache";
import { buildTaskListPath } from "../../pages/environment/overview/projectOverviewUtils";
import { DEFAULT_PAGE_SIZE } from "../../pages/environment/overview/projectOverviewTypes";
import type { NavItem } from "./SidebarNavItem";

export function useSidebarNavigation() {
  const location = useLocation();
  const { user, environments, activeWorkspaceId, activeEnvironmentId, api } = useWorkspaceApp();
  const recentEnvironments = [...environments].sort((a, b) =>
    Number(b.id === activeEnvironmentId) - Number(a.id === activeEnvironmentId)
  ).slice(0, 6);
  const workspaceSettingsExpanded = ["settings", "memory", "connectors"].some(
    (section) => location.pathname === `/app/${activeWorkspaceId}/${section}`
  );

  function prefetchProject(projectId: string): void {
    const project = environments.find((item) => item.id === projectId);
    if (project) {
      api.primeGet?.(`/api/projects/${projectId}`, project);
    }
    void api.prefetchGet?.(`/api/workspaces/${activeWorkspaceId}/bootstrap?projectId=${projectId}`, {
      ttlMs: API_CACHE_TTLS.workspaceMetadata
    }).catch(() => {});
    void api.prefetchGet?.(buildTaskListPath({
      projectId,
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

  const workspaceNavItems: NavItem[] = [
    { to: `/app/${activeWorkspaceId}/projects`, icon: LayoutGrid, label: "All Projects", end: true },
    { to: `/app/${activeWorkspaceId}/search`, icon: Search, label: "Search" },
    { to: `/app/${activeWorkspaceId}/notifications`, icon: Bell, label: "Notifications" },
    { to: `/app/${activeWorkspaceId}/subscription`, icon: Wallet, label: "Subscription" },
    {
      to: `/app/${activeWorkspaceId}/settings`,
      icon: Settings,
      label: "Workspace Settings",
      forceActive: workspaceSettingsExpanded
    }
  ];

  if (user?.is_super_admin) {
    workspaceNavItems.push({ to: `/app/${activeWorkspaceId}/admin`, icon: Shield, label: "Admin Panel" });
  }

  return { recentEnvironments, workspaceSettingsExpanded, prefetchProject, workspaceNavItems };
}
